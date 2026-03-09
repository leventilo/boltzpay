import { BoltzPayError } from "./boltzpay-error";

type ConfigurationErrorCode = "missing_coinbase_credentials" | "invalid_config" | "domain_blocked";

export class ConfigurationError extends BoltzPayError {
  readonly code: ConfigurationErrorCode;
  readonly statusCode = 400;

  constructor(code: ConfigurationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
