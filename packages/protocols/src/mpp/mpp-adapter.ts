import {
  DomainError,
  type Money,
  type ProtocolQuote,
  type ProtocolResult,
} from "@boltzpay/core";
import { Receipt } from "mppx";
import { AdapterError, MppPaymentError, MppQuoteError } from "../adapter-error";
import type { ResponseAwareAdapter } from "../router/protocol-router";
import type { AdapterTimeouts } from "../x402/x402-adapter";
import type { MppWalletConfig } from "./mpp-method-factory";
import { createMppMethod } from "./mpp-method-factory";
import type { MppMethodSelector } from "./mpp-method-selector";
import { hasMppScheme, parseMppChallenges } from "./mpp-parsing";
import { buildMppQuote } from "./mpp-quote-builder";

const DEFAULT_DETECT_MS = 10_000;
const DEFAULT_QUOTE_MS = 15_000;
const DEFAULT_PAYMENT_MS = 30_000;
const HTTP_PAYMENT_REQUIRED = 402;

export interface MppExecuteRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array | undefined;
  readonly amount: Money;
  readonly wallet?: MppWalletConfig & { readonly type: string };
}

export class MppAdapter implements ResponseAwareAdapter {
  readonly name = "mpp";
  private readonly timeouts: Required<AdapterTimeouts>;

  constructor(
    private readonly methodSelector: MppMethodSelector,
    private readonly validateUrl: (url: string) => void,
    timeouts?: AdapterTimeouts,
  ) {
    this.timeouts = {
      detect: timeouts?.detect ?? DEFAULT_DETECT_MS,
      quote: timeouts?.quote ?? DEFAULT_QUOTE_MS,
      payment: timeouts?.payment ?? DEFAULT_PAYMENT_MS,
    };
  }

  async detect(
    url: string,
    _headers?: Record<string, string>,
  ): Promise<boolean> {
    this.validateUrl(url);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeouts.detect),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      throw new MppQuoteError(`Cannot reach endpoint: ${msg}`);
    }
    if (response.status !== HTTP_PAYMENT_REQUIRED) {
      return false;
    }
    const wwwAuth = response.headers.get("www-authenticate");
    if (!wwwAuth) {
      return false;
    }
    return hasMppScheme(wwwAuth);
  }

  async quote(
    url: string,
    _headers?: Record<string, string>,
  ): Promise<ProtocolQuote> {
    this.validateUrl(url);
    const response = await this.fetchForQuote(url);
    return this.extractQuote(response);
  }

  async quoteFromResponse(response: Response): Promise<ProtocolQuote | null> {
    if (response.status !== HTTP_PAYMENT_REQUIRED) {
      return null;
    }
    const wwwAuth = response.headers.get("www-authenticate");
    if (!wwwAuth || !hasMppScheme(wwwAuth)) {
      return null;
    }
    try {
      const { challenges } = parseMppChallenges(wwwAuth);
      return buildMppQuote(challenges, this.methodSelector);
    } catch (err) {
      if (err instanceof AdapterError || err instanceof DomainError) throw err;
      return null;
    }
  }

  async execute(request: MppExecuteRequest): Promise<ProtocolResult> {
    if (!request.wallet) {
      throw new MppPaymentError(
        "MPP wallet configuration required for execute()",
      );
    }

    const method = createMppMethod(request.wallet.type, request.wallet);

    try {
      const { Mppx } = await import("mppx/client");
      const mppx = Mppx.create({
        fetch: globalThis.fetch,
        methods: [method],
        polyfill: false,
      });

      // TS 5.9 Uint8Array<ArrayBufferLike> vs Uint8Array<ArrayBuffer> variance
      const body: ArrayBuffer | undefined = request.body
        ? request.body.buffer instanceof ArrayBuffer
          ? request.body.buffer
          : new ArrayBuffer(request.body.byteLength)
        : undefined;
      const response = await mppx.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body,
        signal: AbortSignal.timeout(this.timeouts.payment),
      });

      return this.buildProtocolResult(response, request.amount);
    } catch (err) {
      if (err instanceof MppPaymentError) throw err;
      const msg = err instanceof Error ? err.message : "Payment failed";
      throw new MppPaymentError(`MPP payment failed: ${msg}`, {
        cause: err,
      });
    }
  }

  private async buildProtocolResult(
    response: Response,
    amount: Money,
  ): Promise<ProtocolResult> {
    let externalTxHash: string | undefined;
    if (response.ok) {
      try {
        const receipt = Receipt.fromResponse(response);
        externalTxHash = `${receipt.method}:${receipt.reference}`;
      } catch {
        // Intent: receipt header may be missing on successful responses (edge case)
      }
    }

    const responseBody = new Uint8Array(await response.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      success: response.ok,
      externalTxHash,
      responseBody,
      responseHeaders,
      responseStatus: response.status,
      actualAmount: amount,
    };
  }

  private async fetchForQuote(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(this.timeouts.quote),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      throw new MppQuoteError(`Cannot reach endpoint: ${msg}`);
    }
    if (response.status !== HTTP_PAYMENT_REQUIRED) {
      throw new MppQuoteError(`Expected 402 status, got ${response.status}`);
    }
    return response;
  }

  private extractQuote(response: Response): ProtocolQuote {
    const wwwAuth = response.headers.get("www-authenticate");
    if (!wwwAuth || !hasMppScheme(wwwAuth)) {
      throw new MppQuoteError("No MPP payment information in 402 response");
    }
    const { challenges } = parseMppChallenges(wwwAuth);
    if (challenges.length === 0) {
      throw new MppQuoteError("No MPP challenges found in response");
    }
    return buildMppQuote(challenges, this.methodSelector);
  }
}
