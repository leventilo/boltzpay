export class AdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export interface DeliveryAttemptResult {
  readonly method: string;
  readonly headerName: string;
  readonly status: number;
  /** Server response body extracted from failed delivery attempt (truncated to 500 chars). */
  readonly serverMessage?: string;
}

export class X402PaymentError extends AdapterError {
  readonly deliveryAttempts?: readonly DeliveryAttemptResult[];
  readonly suggestion?: string;

  constructor(
    message: string,
    opts?: {
      readonly deliveryAttempts?: readonly DeliveryAttemptResult[];
      readonly suggestion?: string;
    },
  ) {
    const fullMessage = opts?.suggestion
      ? `${message}. Suggestion: ${opts.suggestion}`
      : message;
    super("x402_payment_failed", fullMessage);
    this.deliveryAttempts = opts?.deliveryAttempts;
    this.suggestion = opts?.suggestion;
  }
}

export class X402QuoteError extends AdapterError {
  constructor(message: string) {
    super("x402_quote_failed", message);
  }
}

export class CdpProvisioningError extends AdapterError {
  constructor(message: string) {
    super("cdp_provisioning_failed", message);
  }
}

export class L402QuoteError extends AdapterError {
  constructor(message: string) {
    super("l402_quote_failed", message);
  }
}

export class L402PaymentError extends AdapterError {
  constructor(message: string, options?: ErrorOptions) {
    super("l402_payment_failed", message, options);
  }
}

export class L402CredentialsMissingError extends AdapterError {
  constructor() {
    super(
      "l402_credentials_missing",
      "L402 protocol detected but NWC wallet not configured. Add nwcConnectionString to BoltzPay config to enable Lightning payments.",
    );
  }
}

/**
 * Thrown when all payment adapters fail during fallback execution.
 * Contains all individual errors for diagnostic context.
 */
export class AggregatePaymentError extends AdapterError {
  constructor(readonly errors: readonly Error[]) {
    const messages = errors
      .map((e, i) => `  ${i + 1}. ${e.message}`)
      .join("\n");
    super(
      "aggregate_payment_failed",
      `All payment attempts failed:\n${messages}`,
    );
  }
}
