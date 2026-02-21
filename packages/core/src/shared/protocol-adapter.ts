import type { AcceptOption } from "./chain-types";
import type { Money } from "./money.vo";

/** Input hints extracted from the 402 response, describing how to call the endpoint. */
export interface EndpointInputHints {
  /** Expected HTTP method (e.g. "GET", "POST"). */
  readonly method?: string;
  /** Example query parameters (e.g. { city: "Tokyo" }). */
  readonly queryParams?: Readonly<Record<string, string>>;
  /** Expected body fields with type and description. */
  readonly bodyFields?: Readonly<Record<string, unknown>>;
  /** Description of the endpoint. */
  readonly description?: string;
  /** Example output from the endpoint. */
  readonly outputExample?: unknown;
}

/** Price quote returned by a protocol adapter after probing an endpoint. */
export interface ProtocolQuote {
  readonly amount: Money;
  readonly protocol: string;
  readonly network: string | undefined;
  readonly payTo: string | undefined;
  /** All payment accept options from the endpoint (multi-chain passthrough). */
  readonly allAccepts?: readonly AcceptOption[];
  /** Input hints from the 402 response — tells agents what parameters the endpoint expects. */
  readonly inputHints?: EndpointInputHints;
}

/** Result of executing a payment through a protocol adapter. */
export interface ProtocolResult {
  readonly success: boolean;
  readonly externalTxHash: string | undefined;
  readonly responseBody: Uint8Array | undefined;
  readonly responseHeaders: Record<string, string>;
  readonly responseStatus: number;
}

/** Contract that all payment protocol adapters must implement. */
export interface ProtocolAdapter {
  readonly name: string;
  detect(url: string, headers?: Record<string, string>): Promise<boolean>;
  quote(url: string, headers?: Record<string, string>): Promise<ProtocolQuote>;
  execute(request: {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: Uint8Array | undefined;
    readonly amount: Money;
  }): Promise<ProtocolResult>;
}
