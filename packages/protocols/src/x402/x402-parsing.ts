import { X402PaymentError, X402QuoteError } from "../adapter-error";

const PAYMENT_REQUIRED_HEADER = "payment-required";
const PAYMENT_RESPONSE_HEADER = "payment-response";
const WWW_AUTHENTICATE_HEADER = "www-authenticate";
const USDC_DECIMALS = 6;
const DEFAULT_EIP155_NETWORK = "eip155:8453"; // Base mainnet
const PAYMENT_SIGNATURE_HEADER_KEY = "PAYMENT-SIGNATURE";
const V1_PAYMENT_HEADER_KEY = "X-PAYMENT";

interface PaymentRequiredAccept {
  readonly scheme: string;
  readonly network: string;
  readonly amount: string;
  readonly asset: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds?: number;
}

interface PaymentRequiredResource {
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
}

interface BazaarInputInfo {
  readonly type?: string;
  readonly method?: string;
  readonly queryParams?: Readonly<Record<string, string>>;
  readonly bodyType?: string;
  readonly bodyFields?: Readonly<Record<string, unknown>>;
}

interface BazaarOutputInfo {
  readonly type?: string;
  readonly example?: unknown;
}

/** Parsed metadata from the 402 response — resource info + bazaar extensions. */
interface PaymentRequiredMetadata {
  readonly resource?: PaymentRequiredResource;
  readonly bazaarInput?: BazaarInputInfo;
  readonly bazaarOutput?: BazaarOutputInfo;
}

interface PaymentRequiredResponse {
  readonly x402Version: number;
  readonly accepts: readonly PaymentRequiredAccept[];
  readonly resource?: PaymentRequiredResource;
  /** Parsed metadata from resource + extensions.bazaar fields. */
  readonly metadata?: PaymentRequiredMetadata;
}

interface PaymentSettleResponse {
  readonly success: boolean;
  readonly transaction?: string;
  readonly network?: string;
}

type PaymentTransport = "header" | "body" | "www-authenticate";

/** Minimal shape validated by isPaymentRequiredShape / parseWwwAuthenticate. */
interface PaymentRequiredRecord {
  readonly x402Version: number;
  readonly accepts: readonly unknown[];
  readonly [key: string]: unknown;
}

interface NegotiatedPayment {
  readonly paymentRequired: PaymentRequiredRecord | PaymentRequiredResponse;
  readonly version: number;
  readonly transport: PaymentTransport;
  readonly responseHeader: string;
}

function validateV2Accept(raw: unknown): raw is PaymentRequiredAccept {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>; // Safe: guarded by typeof + null check
  return (
    typeof obj.scheme === "string" &&
    typeof obj.network === "string" &&
    typeof obj.amount === "string" &&
    typeof obj.asset === "string" &&
    typeof obj.payTo === "string"
  );
}

function safeBase64Decode(encoded: string): string {
  try {
    return atob(encoded);
  } catch {
    throw new X402QuoteError("Invalid base64 in payment header");
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>) // Safe: guarded by typeof + null check
    : undefined;
}

function extractResource(
  parsed: Record<string, unknown>,
): PaymentRequiredResource | undefined {
  const r = asRecord(parsed.resource);
  if (!r || typeof r.url !== "string") return undefined;
  return {
    url: r.url,
    description: typeof r.description === "string" ? r.description : undefined,
    mimeType: typeof r.mimeType === "string" ? r.mimeType : undefined,
  };
}

function parseBazaarInput(raw: Record<string, unknown>): BazaarInputInfo {
  return {
    type: typeof raw.type === "string" ? raw.type : undefined,
    method: typeof raw.method === "string" ? raw.method : undefined,
    queryParams: asRecord(raw.queryParams) as
      | Record<string, string>
      | undefined,
    bodyType: typeof raw.bodyType === "string" ? raw.bodyType : undefined,
    bodyFields: asRecord(raw.bodyFields),
  };
}

function extractBazaarInfo(
  parsed: Record<string, unknown>,
): { input?: BazaarInputInfo; output?: BazaarOutputInfo } | undefined {
  const ext = asRecord(parsed.extensions);
  const bazaar = ext ? asRecord(ext.bazaar) : undefined;
  const info = bazaar ? asRecord(bazaar.info) : undefined;
  if (!info) return undefined;

  const inputRaw = asRecord(info.input);
  const outputRaw = asRecord(info.output);
  if (!inputRaw && !outputRaw) return undefined;

  return {
    input: inputRaw ? parseBazaarInput(inputRaw) : undefined,
    output: outputRaw
      ? {
          type: typeof outputRaw.type === "string" ? outputRaw.type : undefined,
          example: outputRaw.example,
        }
      : undefined,
  };
}

function extractV1BazaarInput(
  parsed: Record<string, unknown>,
): BazaarInputInfo | undefined {
  if (!Array.isArray(parsed.accepts)) return undefined;
  for (const accept of parsed.accepts) {
    const a = asRecord(accept);
    if (!a) continue;
    const schema = asRecord(a.outputSchema);
    if (!schema) continue;
    const input = asRecord(schema.input);
    if (input) return parseBazaarInput(input);
  }
  return undefined;
}

/** Extract endpoint metadata from the decoded 402 JSON (resource + bazaar extensions). */
function extractMetadata(
  parsed: Record<string, unknown>,
): PaymentRequiredMetadata | undefined {
  const resource = extractResource(parsed);
  const bazaar = extractBazaarInfo(parsed);
  const bazaarInput = bazaar?.input ?? extractV1BazaarInput(parsed);
  const bazaarOutput = bazaar?.output;

  if (!resource && !bazaarInput && !bazaarOutput) return undefined;
  return { resource, bazaarInput, bazaarOutput };
}

function decodePaymentRequired(headerValue: string): PaymentRequiredResponse {
  const json = safeBase64Decode(headerValue);
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("accepts" in parsed) ||
    !Array.isArray((parsed as { accepts: unknown }).accepts)
  ) {
    throw new X402QuoteError("Invalid PAYMENT-REQUIRED header structure");
  }
  const obj = parsed as Record<string, unknown>;
  const { accepts } = obj as { accepts: unknown[] }; // Safe: Array.isArray guard above
  for (const accept of accepts) {
    if (!validateV2Accept(accept)) {
      throw new X402QuoteError(
        "Invalid accept entry: missing network, amount, or payTo",
      );
    }
  }
  const metadata = extractMetadata(obj);
  const result = parsed as PaymentRequiredResponse; // Safe: every field validated above
  if (metadata) {
    return { ...result, metadata };
  }
  return result;
}

// V1 quirk: maxAmountRequired instead of amount, asset = token name not address
function normalizeV1Accept(raw: unknown): PaymentRequiredAccept | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>; // Safe: guarded by typeof + null check

  const amount =
    typeof obj.maxAmountRequired === "string"
      ? obj.maxAmountRequired
      : typeof obj.amount === "string"
        ? obj.amount
        : null;
  const network = typeof obj.network === "string" ? obj.network : null;
  const payTo = typeof obj.payTo === "string" ? obj.payTo : null;
  const asset = typeof obj.asset === "string" ? obj.asset : "";
  const scheme = typeof obj.scheme === "string" ? obj.scheme : "exact";

  if (!amount || !network || !payTo) return null;
  return { scheme, network, amount, asset, payTo };
}

function parseV1Body(body: unknown): PaymentRequiredResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const obj = body as Record<string, unknown>; // Safe: guarded by typeof + null check

  const version = typeof obj.x402Version === "number" ? obj.x402Version : -1;
  if (version < 1) return null;
  if (!Array.isArray(obj.accepts) || obj.accepts.length === 0) return null;

  const accepts: PaymentRequiredAccept[] = [];
  for (const raw of obj.accepts) {
    const normalized = normalizeV1Accept(raw);
    if (normalized) accepts.push(normalized);
  }
  if (accepts.length === 0) return null;

  const metadata = extractMetadata(obj);
  if (metadata) {
    return { x402Version: version, accepts, metadata };
  }
  return { x402Version: version, accepts };
}

const MAX_DISPLAY_AMOUNT_LENGTH = 40;

// www-authenticate quirk: amount in USDC display units ("0.01") not atomic
// Uses string-based decimal parsing to avoid floating-point precision loss
function usdcDisplayToAtomic(displayAmount: string): string | null {
  if (!displayAmount || displayAmount.startsWith("-")) return null;
  if (displayAmount.length > MAX_DISPLAY_AMOUNT_LENGTH) return null;
  const parts = displayAmount.split(".");
  if (parts.length > 2) return null;
  const whole = parts[0] ?? "0";
  const frac = (parts[1] ?? "")
    .padEnd(USDC_DECIMALS, "0")
    .slice(0, USDC_DECIMALS);
  try {
    const atomic = BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(frac);
    if (atomic < 0n) return null;
    return atomic.toString();
  } catch {
    return null;
  }
}

function parseWwwAuthenticate(
  headerValue: string,
): PaymentRequiredResponse | null {
  const x402Index = headerValue.indexOf("x402 ");
  if (x402Index === -1) return null;

  const content = headerValue.slice(x402Index + 5);
  const params: Record<string, string> = {};
  for (const match of content.matchAll(/(\w+)="([^"]*)"/g)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      params[key] = value;
    }
  }

  const address = params.address;
  const rawAmount = params.amount;
  if (!address || !rawAmount) return null;

  const atomicAmount = usdcDisplayToAtomic(rawAmount);
  if (!atomicAmount) return null;

  const chainId = params.chainId;
  const network = chainId ? `eip155:${chainId}` : DEFAULT_EIP155_NETWORK;
  const token = params.token ?? "";

  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network,
        amount: atomicAmount,
        asset: token,
        payTo: address,
      },
    ],
  };
}

async function extractPaymentInfo(
  response: Response,
): Promise<PaymentRequiredResponse | null> {
  if (response.status !== 402) return null;

  const paymentHeader = response.headers.get(PAYMENT_REQUIRED_HEADER);
  if (paymentHeader) {
    try {
      return decodePaymentRequired(paymentHeader);
    } catch {
      // V1 fallback: some servers send V1-formatted payload in a V2 header
    }
    try {
      const headerJson: unknown = JSON.parse(safeBase64Decode(paymentHeader));
      const v1FromHeader = parseV1Body(headerJson);
      if (v1FromHeader) return v1FromHeader;
    } catch {}
  }

  const wwwAuth = response.headers.get(WWW_AUTHENTICATE_HEADER);
  if (wwwAuth) {
    const result = parseWwwAuthenticate(wwwAuth);
    if (result) return result;
  }

  try {
    const body: unknown = await response.json();
    return parseV1Body(body);
  } catch {
    return null;
  }
}

function decodePaymentResponse(headerValue: string): PaymentSettleResponse {
  const json = safeBase64Decode(headerValue);
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    throw new X402PaymentError("Invalid payment-response header");
  }
  const obj = parsed as Record<string, unknown>; // Safe: guarded by typeof + null check
  return {
    success: typeof obj.success === "boolean" ? obj.success : false,
    transaction:
      typeof obj.transaction === "string" ? obj.transaction : undefined,
    network: typeof obj.network === "string" ? obj.network : undefined,
  };
}

function isPaymentRequiredShape(data: unknown): data is PaymentRequiredRecord {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>; // Safe: guarded by typeof + null check
  return typeof obj.x402Version === "number" && Array.isArray(obj.accepts);
}

async function negotiatePayment(
  response: Response,
): Promise<NegotiatedPayment | undefined> {
  if (response.status !== 402) return undefined;

  const paymentHeader = response.headers.get(PAYMENT_REQUIRED_HEADER);
  if (paymentHeader) {
    try {
      const json = safeBase64Decode(paymentHeader);
      const parsed: unknown = JSON.parse(json);
      if (isPaymentRequiredShape(parsed)) {
        const version = parsed.x402Version;
        return {
          paymentRequired: parsed,
          version,
          transport: "header",
          responseHeader:
            version === 1
              ? V1_PAYMENT_HEADER_KEY
              : PAYMENT_SIGNATURE_HEADER_KEY,
        };
      }
    } catch {}
  }

  const wwwAuth = response.headers.get(WWW_AUTHENTICATE_HEADER);
  if (wwwAuth) {
    const parsed = parseWwwAuthenticate(wwwAuth);
    if (parsed) {
      return {
        paymentRequired: parsed,
        version: 2,
        transport: "www-authenticate",
        responseHeader: PAYMENT_SIGNATURE_HEADER_KEY,
      };
    }
  }

  try {
    const body: unknown = await response.json();
    if (isPaymentRequiredShape(body)) {
      const version = body.x402Version;
      return {
        paymentRequired: body,
        version,
        transport: "body",
        responseHeader: V1_PAYMENT_HEADER_KEY,
      };
    }
  } catch {}

  return undefined;
}

export {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER_KEY,
  V1_PAYMENT_HEADER_KEY,
  extractPaymentInfo,
  negotiatePayment,
  decodePaymentResponse,
  type PaymentRequiredAccept,
  type PaymentRequiredMetadata,
  type PaymentRequiredResponse,
  type PaymentTransport,
  type PaymentRequiredRecord,
  type NegotiatedPayment,
};
