import { BoltzPayError } from "./boltzpay-error";

type NetworkErrorCode =
  | "network_timeout"
  | "endpoint_unreachable"
  | "blockchain_error";

/** Thrown for network-level failures (timeout, unreachable, blockchain). Codes: `network_timeout`, `endpoint_unreachable`, `blockchain_error`. */
export class NetworkError extends BoltzPayError {
  readonly code: NetworkErrorCode;
  readonly statusCode = 503;

  constructor(code: NetworkErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
