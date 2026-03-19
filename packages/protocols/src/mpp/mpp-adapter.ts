import type {
  ProtocolAdapter,
  ProtocolQuote,
  ProtocolResult,
} from "@boltzpay/core";
import { MppPaymentError, MppQuoteError } from "../adapter-error";
import type { ResponseAwareAdapter } from "../router/protocol-router";
import type { AdapterTimeouts } from "../x402/x402-adapter";
import type { MppMethodSelector } from "./mpp-method-selector";
import { hasMppScheme, parseMppChallenges } from "./mpp-parsing";
import { buildMppQuote } from "./mpp-quote-builder";

const DEFAULT_DETECT_MS = 10_000;
const DEFAULT_QUOTE_MS = 15_000;
const DEFAULT_PAYMENT_MS = 30_000;
const HTTP_PAYMENT_REQUIRED = 402;

export class MppAdapter implements ResponseAwareAdapter {
  readonly name = "mpp";
  private readonly timeouts: Required<AdapterTimeouts>;

  constructor(
    private readonly methodSelector: MppMethodSelector,
    private readonly validateUrl: (url: string) => void,
    timeouts?: AdapterTimeouts,
  ) {
    this.timeouts = {
      detect: timeouts?.detect ?? DEFAULT_DETECT_MS,
      quote: timeouts?.quote ?? DEFAULT_QUOTE_MS,
      payment: timeouts?.payment ?? DEFAULT_PAYMENT_MS,
    };
  }

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
        signal: AbortSignal.timeout(this.timeouts.detect),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      throw new MppQuoteError(`Cannot reach endpoint: ${msg}`);
    }
    if (response.status !== HTTP_PAYMENT_REQUIRED) {
      return false;
    }
    const wwwAuth = response.headers.get("www-authenticate");
    if (!wwwAuth) {
      return false;
    }
    return hasMppScheme(wwwAuth);
  }

  async quote(
    url: string,
    _headers?: Record<string, string>,
  ): Promise<ProtocolQuote> {
    this.validateUrl(url);
    const response = await this.fetchForQuote(url);
    return this.extractQuote(response);
  }

  async quoteFromResponse(response: Response): Promise<ProtocolQuote | null> {
    if (response.status !== HTTP_PAYMENT_REQUIRED) {
      return null;
    }
    const wwwAuth = response.headers.get("www-authenticate");
    if (!wwwAuth || !hasMppScheme(wwwAuth)) {
      return null;
    }
    try {
      const { challenges } = parseMppChallenges(wwwAuth);
      return buildMppQuote(challenges, this.methodSelector);
    } catch {
      return null;
    }
  }

  async execute(_request: {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: Uint8Array | undefined;
    readonly amount: import("@boltzpay/core").Money;
  }): Promise<ProtocolResult> {
    throw new MppPaymentError(
      "MPP execute() not implemented -- see Phase 18",
    );
  }

  private async fetchForQuote(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(this.timeouts.quote),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      throw new MppQuoteError(`Cannot reach endpoint: ${msg}`);
    }
    if (response.status !== HTTP_PAYMENT_REQUIRED) {
      throw new MppQuoteError(
        `Expected 402 status, got ${response.status}`,
      );
    }
    return response;
  }

  private extractQuote(response: Response): ProtocolQuote {
    const wwwAuth = response.headers.get("www-authenticate");
    if (!wwwAuth || !hasMppScheme(wwwAuth)) {
      throw new MppQuoteError(
        "No MPP payment information in 402 response",
      );
    }
    const { challenges } = parseMppChallenges(wwwAuth);
    if (challenges.length === 0) {
      throw new MppQuoteError("No MPP challenges found in response");
    }
    return buildMppQuote(challenges, this.methodSelector);
  }
}
