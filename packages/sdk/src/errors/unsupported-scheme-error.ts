import type { Money } from "@boltzpay/core";
import { BoltzPayError } from "./boltzpay-error";

export class UnsupportedSchemeError extends BoltzPayError {
  readonly code = "unsupported_scheme" as const;
  readonly statusCode = 501;
  readonly scheme: string;
  readonly maxAmount?: Money;
  readonly network?: string;

  constructor(opts: { scheme: string; maxAmount?: Money; network?: string }) {
    super(
      `Payment scheme "${opts.scheme}" is not yet supported. ` +
        `Track progress: https://github.com/leventilo/boltzpay/issues`,
    );
    this.scheme = opts.scheme;
    this.maxAmount = opts.maxAmount;
    this.network = opts.network;
  }
}
