import type { ProtocolResult } from "@boltzpay/core";
import { type DeliveryAttemptResult, X402PaymentError } from "../adapter-error";
import {
  decodePaymentResponse,
  type NegotiatedPayment,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER_KEY,
  V1_PAYMENT_HEADER_KEY,
} from "./x402-parsing";

interface DeliveryAttempt {
  readonly method: string;
  readonly headerName: string;
}

interface AdaptiveDeliveryContext {
  readonly request: {
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly body: Uint8Array | undefined;
  };
  readonly plan: readonly DeliveryAttempt[];
  readonly negotiation: NegotiatedPayment;
  readonly signPayment: (paymentRequired: unknown) => Promise<unknown>;
  readonly safeFetch: typeof fetch;
}

const SERVER_MESSAGE_MAX_LENGTH = 500;

/** Extract a human-readable error message from a failed delivery response body. */
async function extractResponseMessage(
  response: Response,
): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text.trim()) return undefined;

    try {
      const json: unknown = JSON.parse(text);
      if (typeof json === "object" && json !== null) {
        const obj = json as Record<string, unknown>;
        if (typeof obj.error === "string") return obj.error;
        if (typeof obj.message === "string") return obj.message;
        if (typeof obj.error === "object" && obj.error !== null) {
          const nested = obj.error as Record<string, unknown>;
          if (typeof nested.message === "string") return nested.message;
        }
      }
    } catch {}

    return text.length > SERVER_MESSAGE_MAX_LENGTH
      ? `${text.slice(0, SERVER_MESSAGE_MAX_LENGTH)}…`
      : text;
  } catch {
    return undefined;
  }
}

function encodePaymentPayload(payload: unknown): string {
  const json = JSON.stringify(payload);
  try {
    return btoa(json);
  } catch {
    throw new X402PaymentError("Failed to encode payment payload");
  }
}

function buildDeliveryPlan(
  negotiation: NegotiatedPayment,
  requestMethod: string,
): readonly DeliveryAttempt[] {
  const alternateHeader =
    negotiation.responseHeader === PAYMENT_SIGNATURE_HEADER_KEY
      ? V1_PAYMENT_HEADER_KEY
      : PAYMENT_SIGNATURE_HEADER_KEY;

  // V1 endpoints commonly require POST for payment delivery.
  // Try POST first on GET requests to avoid nonce consumption on 405 failures
  // from Next.js middleware (known issue coinbase/x402 #259, #644).
  if (negotiation.version === 1 && requestMethod === "GET") {
    return [
      { method: "POST", headerName: negotiation.responseHeader },
      { method: "GET", headerName: negotiation.responseHeader },
      { method: "GET", headerName: alternateHeader },
    ];
  }

  const primary: DeliveryAttempt = {
    method: requestMethod,
    headerName: negotiation.responseHeader,
  };
  const attempts: DeliveryAttempt[] = [primary];

  if (requestMethod === "GET") {
    attempts.push({ method: "POST", headerName: negotiation.responseHeader });
  }

  attempts.push({ method: requestMethod, headerName: alternateHeader });
  return attempts;
}

// 402/405/404 on paid retry = server did not process payment, nonce untouched.
// 402 = "payment required" again (server didn't see our header, wrong method/header)
// 405 = method not allowed (server needs POST), 404 = route mismatch
function isNonceSafe(status: number): boolean {
  return status === 402 || status === 405 || status === 404;
}

// Retry on: 402 (payment not seen), 405 (wrong method), 400 (wrong header format)
function isRetryableStatus(status: number): boolean {
  return status === 402 || status === 405 || status === 400;
}

function inferSigningErrorSuggestion(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("eip-712") || lower.includes("domain")) {
    return "Server sent incomplete EIP-712 signing parameters. This is a server-side configuration issue — the endpoint's x402 setup is missing required domain fields (name, version).";
  }
  if (lower.includes("timeout") || lower.includes("terminated")) {
    return "Payment signing timed out or was terminated. The signing service may be temporarily unavailable.";
  }
  if (lower.includes("insufficient") || lower.includes("balance")) {
    return "Wallet balance may be insufficient to cover the payment and gas fees.";
  }
  return `Payment could not be signed: ${message.slice(0, 150)}`;
}

function inferDeliverySuggestion(
  results: readonly DeliveryAttemptResult[],
): string | undefined {
  const hasMethodRejection = results.some((r) => r.status === 405);
  const postGot402 = results.some(
    (r) => r.method === "POST" && r.status === 402,
  );
  const has400 = results.some((r) => r.status === 400);

  const firstServerMessage = results.find(
    (r) => r.serverMessage,
  )?.serverMessage;

  // GET → 405, POST → 402 = endpoint needs POST with a request body
  if (hasMethodRejection && postGot402) {
    return "Endpoint requires POST with a request body. Retry with method: 'POST', headers: { 'Content-Type': 'application/json' }, and a JSON body.";
  }

  // 400 with server message = specific rejection reason from the server
  if (has400 && firstServerMessage) {
    return `Server rejected the request (400): ${firstServerMessage}`;
  }

  // All 400 = server consistently rejects — could be missing params or signature issue
  if (results.length > 0 && results.every((r) => r.status === 400)) {
    return "Server rejected all delivery attempts with 400. The endpoint may require specific request parameters (query string or body).";
  }

  // Mixed 400 + other retryable = likely a server-side compatibility issue
  if (has400) {
    return "Server returned 400 on some delivery attempts. The endpoint may require specific request parameters or use a non-standard payment verification flow.";
  }

  // All 402 = server never sees our payment header
  if (results.length > 0 && results.every((r) => r.status === 402)) {
    return "Server did not recognize any payment format. The endpoint may use an unsupported x402 protocol variant.";
  }

  return undefined;
}

function throwDeliveryExhausted(
  results: readonly DeliveryAttemptResult[],
  totalAttempts: number,
): never {
  const summary = results
    .map((r) => `${r.method} + ${r.headerName} → ${r.status}`)
    .join("; ");
  const suggestion = inferDeliverySuggestion(results);

  throw new X402PaymentError(
    `Payment rejected after ${totalAttempts} delivery attempts: ${summary}`,
    { deliveryAttempts: results, suggestion },
  );
}

async function buildProtocolResult(
  response: Response,
): Promise<ProtocolResult> {
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  let externalTxHash: string | undefined;
  const paymentResponseHeader = response.headers.get(PAYMENT_RESPONSE_HEADER);
  if (paymentResponseHeader) {
    try {
      const settlement = decodePaymentResponse(paymentResponseHeader);
      externalTxHash = settlement.transaction;
    } catch {
      // Settlement parse failure is non-fatal — payment already succeeded
    }
  }

  const responseBody = new Uint8Array(await response.arrayBuffer());
  return {
    success: response.ok,
    externalTxHash,
    responseBody,
    responseHeaders,
    responseStatus: response.status,
  };
}

async function adaptiveDeliver(
  ctx: AdaptiveDeliveryContext,
): Promise<ProtocolResult> {
  const { request, plan, negotiation, signPayment, safeFetch } = ctx;
  const results: DeliveryAttemptResult[] = [];
  let cachedPayload: string | undefined;
  let lastMethod: string | undefined;

  for (const attempt of plan) {
    // Re-sign when switching HTTP methods: the previous attempt may have
    // consumed the nonce even when the server returned 405 (middleware processed
    // payment before rejecting the method).
    const methodChanged =
      lastMethod !== undefined && attempt.method !== lastMethod;

    if (!cachedPayload || methodChanged) {
      try {
        const payload = await signPayment(negotiation.paymentRequired);
        cachedPayload = encodePaymentPayload(payload);
      } catch (signErr) {
        if (signErr instanceof X402PaymentError) throw signErr;
        const msg =
          signErr instanceof Error ? signErr.message : String(signErr);
        throw new X402PaymentError(`Payment signing failed: ${msg}`, {
          suggestion: inferSigningErrorSuggestion(msg),
        });
      }
    }

    const response = await safeFetch(request.url, {
      method: attempt.method,
      headers: { ...request.headers, [attempt.headerName]: cachedPayload },
      body: request.body ? new Uint8Array(request.body) : undefined,
    });

    if (!isRetryableStatus(response.status)) {
      return buildProtocolResult(response);
    }

    const serverMessage =
      response.status === 400
        ? await extractResponseMessage(response)
        : undefined;

    // 402/405/404 = server likely did not settle the payment, nonce reusable
    // for same method. 400 = re-sign unconditionally (nonce may be spent).
    if (!isNonceSafe(response.status)) {
      cachedPayload = undefined;
    }

    lastMethod = attempt.method;
    results.push({
      method: attempt.method,
      headerName: attempt.headerName,
      status: response.status,
      serverMessage,
    });
  }

  throwDeliveryExhausted(results, plan.length);
}

export { buildDeliveryPlan, adaptiveDeliver, buildProtocolResult };
