import { DomainError } from "./domain-error";

/** Thrown when no payment protocol is detected on an endpoint. Code: `protocol_detection_failed`. */
export class ProtocolDetectionFailedError extends DomainError {
  readonly code = "protocol_detection_failed";
  constructor(url: string) {
    super(`Could not detect payment protocol for ${url}`);
  }
}

/** Thrown when the endpoint requires a chain the SDK wallet does not support. Code: `no_compatible_chain`. */
export class NoCompatibleChainError extends DomainError {
  readonly code = "no_compatible_chain";
  constructor(wantedNamespaces: string[], supportedNamespaces: string[]) {
    super(
      `No compatible payment chain. Endpoint accepts: [${wantedNamespaces.join(", ")}]. SDK supports: [${supportedNamespaces.join(", ")}].`,
    );
  }
}

/** Thrown when a CAIP-2 network string cannot be parsed. Code: `invalid_network_identifier`. */
export class InvalidNetworkIdentifierError extends DomainError {
  readonly code = "invalid_network_identifier";
  constructor(raw: string) {
    super(`Invalid CAIP-2 network identifier: ${raw}`);
  }
}
