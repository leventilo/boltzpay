import {
  Money,
  type ProtocolAdapter,
  type ProtocolQuote,
  type ProtocolResult,
} from "@boltzpay/core";
import {
  L402CredentialsMissingError,
  L402PaymentError,
  L402QuoteError,
} from "../adapter-error";
import type { NwcWalletManager } from "../nwc/nwc-wallet-manager";
import {
  decodeBolt11AmountWith,
  isL402Challenge,
  type L402ParsedChallenge,
  parseL402Challenge,
} from "./l402-types";

const DETECTION_TIMEOUT_MS = 10_000;
const QUOTE_TIMEOUT_MS = 15_000;

const SATS_DISPLAY_PROTOCOL = "l402";
const LIGHTNING_NETWORK = "lightning";

type Bolt11Decoder = (invoice: string) => {
  sections: ReadonlyArray<{ name: string; value: unknown }>;
};

/**
 * L402 (Lightning Labs) payment protocol adapter.
 *
 * Flow: GET url -> 402 + WWW-Authenticate: L402 -> pay BOLT11 invoice via NWC -> retry with proof.
 */
export class L402Adapter implements ProtocolAdapter {
  readonly name = "l402";
  private cachedDecoder: Bolt11Decoder | undefined;

  constructor(
    private readonly walletManager: NwcWalletManager | undefined,
    private readonly validateUrl: (url: string) => void,
  ) {}

  async detect(
    url: string,
    _headers?: Record<string, string>,
  ): Promise<boolean> {
    this.validateUrl(url);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(DETECTION_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      throw new L402QuoteError(`Cannot reach endpoint: ${msg}`);
    }
    if (response.status !== 402) {
      return false;
    }
    const wwwAuth = response.headers.get("www-authenticate");
    if (!wwwAuth) return false;
    return isL402Challenge(wwwAuth);
  }

  async quote(
    url: string,
    _headers?: Record<string, string>,
  ): Promise<ProtocolQuote> {
    this.validateUrl(url);

    const response = await this.fetchForQuote(url);
    const wwwAuth = response.headers.get("www-authenticate");
    if (!wwwAuth) {
      throw new L402QuoteError("No WWW-Authenticate header in 402 response");
    }

    const challenge = this.parseChallenge(wwwAuth);
    const sats = await this.decodeInvoiceAmount(challenge.invoice);

    return {
      amount: Money.fromSatoshis(sats),
      protocol: SATS_DISPLAY_PROTOCOL,
      network: LIGHTNING_NETWORK,
      payTo: undefined,
    };
  }

  async quoteFromResponse(response: Response): Promise<ProtocolQuote | null> {
    if (response.status !== 402) return null;
    const wwwAuth = response.headers.get("www-authenticate");
    if (!wwwAuth || !isL402Challenge(wwwAuth)) return null;
    try {
      const challenge = this.parseChallenge(wwwAuth);
      const sats = await this.decodeInvoiceAmount(challenge.invoice);
      return {
        amount: Money.fromSatoshis(sats),
        protocol: SATS_DISPLAY_PROTOCOL,
        network: LIGHTNING_NETWORK,
        payTo: undefined,
      };
    } catch {
      return null;
    }
  }

  async execute(request: {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: Uint8Array | undefined;
    readonly amount: Money;
  }): Promise<ProtocolResult> {
    this.validateUrl(request.url);

    if (!this.walletManager) {
      throw new L402CredentialsMissingError();
    }

    try {
      const firstResponse = await this.sendRequest(request);

      if (firstResponse.status !== 402) {
        return this.buildResult(firstResponse);
      }

      const wwwAuth = firstResponse.headers.get("www-authenticate");
      if (!wwwAuth) {
        throw new L402PaymentError(
          "No WWW-Authenticate header in 402 response",
        );
      }

      const challenge = this.parseChallenge(wwwAuth);
      const { preimage } = await this.walletManager.payInvoice(
        challenge.invoice,
      );

      const retryResponse =
        challenge.kind === "standard"
          ? await this.sendAuthorized(
              request,
              challenge.macaroon,
              preimage,
              challenge.prefix,
            )
          : await this.sendWithPaymentHash(request, challenge.paymentHash);
      return this.buildResult(retryResponse);
    } catch (err) {
      if (
        err instanceof L402PaymentError ||
        err instanceof L402CredentialsMissingError
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : "Unknown payment error";
      throw new L402PaymentError(msg);
    }
  }

  private async sendRequest(request: {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: Uint8Array | undefined;
  }): Promise<Response> {
    return fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ? new Uint8Array(request.body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
    });
  }

  private async sendAuthorized(
    request: {
      readonly url: string;
      readonly method: string;
      readonly headers: Record<string, string>;
      readonly body: Uint8Array | undefined;
    },
    macaroon: string,
    preimage: string,
    prefix: "L402" | "LSAT",
  ): Promise<Response> {
    return fetch(request.url, {
      method: request.method,
      headers: {
        ...request.headers,
        Authorization: `${prefix} ${macaroon}:${preimage}`,
      },
      body: request.body ? new Uint8Array(request.body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
    });
  }

  /**
   * Retry for invoice-only L402 (MaxSats style): inject payment_hash into the JSON body.
   */
  private async sendWithPaymentHash(
    request: {
      readonly url: string;
      readonly method: string;
      readonly headers: Record<string, string>;
      readonly body: Uint8Array | undefined;
    },
    paymentHash: string,
  ): Promise<Response> {
    let bodyJson: string;
    if (request.body && request.body.length > 0) {
      try {
        const text = new TextDecoder().decode(request.body);
        const parsed: Record<string, unknown> = JSON.parse(text) as Record<
          string,
          unknown
        >;
        parsed.payment_hash = paymentHash;
        bodyJson = JSON.stringify(parsed);
      } catch {
        bodyJson = JSON.stringify({ payment_hash: paymentHash });
      }
    } else {
      bodyJson = JSON.stringify({ payment_hash: paymentHash });
    }

    return fetch(request.url, {
      method: request.method === "GET" ? "POST" : request.method,
      headers: {
        ...request.headers,
        "Content-Type": "application/json",
      },
      body: bodyJson,
      redirect: "error",
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
    });
  }

  private async fetchForQuote(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      throw new L402QuoteError(`Failed to reach endpoint: ${msg}`);
    }
    if (response.status !== 402) {
      throw new L402QuoteError(`Expected 402 status, got ${response.status}`);
    }
    return response;
  }

  private parseChallenge(wwwAuth: string): L402ParsedChallenge {
    try {
      return parseL402Challenge(wwwAuth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Parse error";
      throw new L402QuoteError(`Failed to parse L402 challenge: ${msg}`);
    }
  }

  private async decodeInvoiceAmount(invoice: string): Promise<bigint> {
    try {
      const decode = await this.getDecoder();
      return decodeBolt11AmountWith(decode, invoice);
    } catch (err) {
      if (err instanceof L402QuoteError) throw err;
      const msg = err instanceof Error ? err.message : "Decode error";
      throw new L402QuoteError(`Failed to decode BOLT11 invoice: ${msg}`);
    }
  }

  private async getDecoder(): Promise<Bolt11Decoder> {
    if (this.cachedDecoder) return this.cachedDecoder;
    const mod: unknown = await import("light-bolt11-decoder");
    if (
      !mod ||
      typeof mod !== "object" ||
      !("decode" in mod) ||
      typeof (mod as Record<string, unknown>).decode !== "function"
    ) {
      throw new L402QuoteError(
        "light-bolt11-decoder module does not export a decode function",
      );
    }
    const decoder = (mod as { decode: Bolt11Decoder }).decode;
    this.cachedDecoder = decoder;
    return decoder;
  }

  private async buildResult(response: Response): Promise<ProtocolResult> {
    const body = new Uint8Array(await response.arrayBuffer());
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      success: response.status >= 200 && response.status < 300,
      externalTxHash: undefined,
      responseBody: body,
      responseHeaders: headers,
      responseStatus: response.status,
    };
  }
}
