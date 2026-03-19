import type { AcceptOption } from "./chain-types";
import type { Money } from "./money.vo";

export interface EndpointInputHints {
  readonly method?: string;
  readonly queryParams?: Readonly<Record<string, string>>;
  readonly bodyFields?: Readonly<Record<string, unknown>>;
  readonly description?: string;
  readonly outputExample?: unknown;
}

export interface MppMethodQuote {
  readonly method: string;
  readonly intent: string;
  readonly amount: Money;
  readonly currency: string;
  readonly network: string | undefined;
  readonly recipient: string | undefined;
}

export interface ProtocolQuote {
  readonly amount: Money;
  readonly protocol: string;
  readonly network: string | undefined;
  readonly payTo: string | undefined;
  readonly scheme: string;
  readonly allAccepts?: readonly AcceptOption[];
  readonly inputHints?: EndpointInputHints;
  readonly allMethods?: readonly MppMethodQuote[];
  readonly selectedMethod?: string;
  readonly priceUnknown?: boolean;
}

export interface ProtocolResult {
  readonly success: boolean;
  readonly externalTxHash: string | undefined;
  readonly responseBody: Uint8Array | undefined;
  readonly responseHeaders: Record<string, string>;
  readonly responseStatus: number;
  readonly actualAmount?: Money;
}

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
