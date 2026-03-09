import {
  safeBase64Decode,
  isPaymentRequiredShape,
  parseV1Body,
  parseWwwAuthenticate,
  decodePaymentRequired,
  decodePaymentResponse,
  X402_VERSION_1,
  X402_VERSION_2,
  type PaymentRequiredAccept,
  type PaymentRequiredMetadata,
  type PaymentRequiredResponse,
  type PaymentTransport,
  type PaymentRequiredRecord,
  type NegotiatedPayment,
} from "./x402-parsing-helpers";

const HTTP_PAYMENT_REQUIRED = 402;
const PAYMENT_REQUIRED_HEADER = "payment-required";
const PAYMENT_RESPONSE_HEADER = "payment-response";
const WWW_AUTHENTICATE_HEADER = "www-authenticate";
const PAYMENT_SIGNATURE_HEADER_KEY = "PAYMENT-SIGNATURE";
const V1_PAYMENT_HEADER_KEY = "X-PAYMENT";

interface PaymentSource {
  readonly data: PaymentRequiredRecord;
  readonly transport: PaymentTransport;
  readonly responseHeader: string;
  readonly version: number;
}

async function resolvePaymentSource(response: Response): Promise<PaymentSource | null> {
  if (response.status !== HTTP_PAYMENT_REQUIRED) return null;

  const paymentHeader = response.headers.get(PAYMENT_REQUIRED_HEADER);
  if (paymentHeader) {
    try {
      const json = safeBase64Decode(paymentHeader);
      const parsed: unknown = JSON.parse(json);
      if (isPaymentRequiredShape(parsed)) {
        const version = parsed.x402Version;
        return {
          data: parsed,
          transport: "header",
          responseHeader: version === X402_VERSION_1 ? V1_PAYMENT_HEADER_KEY : PAYMENT_SIGNATURE_HEADER_KEY,
          version,
        };
      }
    } catch {
    }
  }

  const wwwAuth = response.headers.get(WWW_AUTHENTICATE_HEADER);
  if (wwwAuth) {
    const parsed = parseWwwAuthenticate(wwwAuth);
    if (parsed) {
      return {
        data: parsed as PaymentRequiredRecord,
        transport: "www-authenticate",
        responseHeader: PAYMENT_SIGNATURE_HEADER_KEY,
        version: X402_VERSION_2,
      };
    }
  }

  try {
    const body: unknown = await response.json();
    if (isPaymentRequiredShape(body)) {
      const version = body.x402Version;
      return {
        data: body,
        transport: "body",
        responseHeader: version === X402_VERSION_1 ? V1_PAYMENT_HEADER_KEY : PAYMENT_SIGNATURE_HEADER_KEY,
        version,
      };
    }
  } catch {
  }

  return null;
}

function toPaymentRequiredResponse(source: PaymentSource): PaymentRequiredResponse | null {
  const { data, transport } = source;

  if (transport === "header") {
    const record = data as Record<string, unknown>;

    try {
      const json = JSON.stringify(record);
      const encoded = btoa(json);
      return decodePaymentRequired(encoded);
    } catch {
    }

    const v1Result = parseV1Body(record);
    if (v1Result) return v1Result;
    return null;
  }

  if (transport === "www-authenticate") {
    return data as unknown as PaymentRequiredResponse;
  }

  return parseV1Body(data as Record<string, unknown>);
}

async function extractPaymentInfo(response: Response): Promise<PaymentRequiredResponse | null> {
  const source = await resolvePaymentSource(response);
  if (!source) return null;
  return toPaymentRequiredResponse(source);
}

async function negotiatePayment(response: Response): Promise<NegotiatedPayment | undefined> {
  const source = await resolvePaymentSource(response);
  if (!source) return undefined;
  return {
    paymentRequired: source.data,
    version: source.version,
    transport: source.transport,
    responseHeader: source.responseHeader,
  };
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
