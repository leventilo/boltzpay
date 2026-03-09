import { BoltzPayError } from "./boltzpay-error";

export type ProtocolErrorCode =
  | "protocol_detection_failed"
  | "protocol_not_supported"
  | "payment_failed"
  | "no_compatible_chain"
  | "x402_payment_failed"
  | "x402_quote_failed"
  | "l402_payment_failed"
  | "l402_quote_failed"
  | "l402_detection_failed"
  | "l402_credentials_missing"
  | "cdp_provisioning_failed";

const PROTOCOL_ERROR_CODE_SET: ReadonlySet<string> = new Set<ProtocolErrorCode>(
  [
    "protocol_detection_failed",
    "protocol_not_supported",
    "payment_failed",
    "no_compatible_chain",
    "x402_payment_failed",
    "x402_quote_failed",
    "l402_payment_failed",
    "l402_quote_failed",
    "l402_detection_failed",
    "l402_credentials_missing",
    "cdp_provisioning_failed",
  ],
);

export function isProtocolErrorCode(value: string): value is ProtocolErrorCode {
  return PROTOCOL_ERROR_CODE_SET.has(value);
}

export interface DiagnosisDeliveryAttempt {
  readonly method: string;
  readonly headerName: string;
  readonly status: number;
  readonly serverMessage?: string;
}

export interface DeliveryDiagnosis {
  readonly phase: "detection" | "payment" | "delivery";
  readonly paymentSent: boolean;
  readonly serverStatus?: number;
  readonly serverMessage?: string;
  readonly suggestion?: string;
  readonly deliveryAttempts?: readonly DiagnosisDeliveryAttempt[];
}

export class ProtocolError extends BoltzPayError {
  readonly code: ProtocolErrorCode;
  readonly statusCode = 502;
  readonly diagnosis?: DeliveryDiagnosis;

  constructor(
    code: ProtocolErrorCode,
    message: string,
    diagnosis?: DeliveryDiagnosis,
  ) {
    super(message);
    this.code = code;
    this.diagnosis = diagnosis;
  }
}
