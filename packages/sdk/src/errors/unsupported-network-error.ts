import { BoltzPayError } from "./boltzpay-error";

export class UnsupportedNetworkError extends BoltzPayError {
  readonly code = "unsupported_network" as const;
  readonly statusCode = 501;
  readonly namespace: string;

  constructor(namespace: string) {
    super(
      `Network namespace "${namespace}" is recognized but payment execution is not yet supported.`,
    );
    this.namespace = namespace;
  }
}
