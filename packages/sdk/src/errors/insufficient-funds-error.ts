import { BoltzPayError } from "./boltzpay-error";

type InsufficientFundsErrorCode =
  | "insufficient_usdc"
  | "insufficient_lightning_balance";

/** Thrown when the wallet lacks funds to complete a payment. Codes: `insufficient_usdc`, `insufficient_lightning_balance`. */
export class InsufficientFundsError extends BoltzPayError {
  readonly code: InsufficientFundsErrorCode;
  readonly statusCode = 402;

  constructor(code: InsufficientFundsErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
