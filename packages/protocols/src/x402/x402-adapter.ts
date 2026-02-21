import {
  Money,
  type ProtocolAdapter,
  type ProtocolQuote,
  type ProtocolResult,
} from "@boltzpay/core";
import { X402PaymentError, X402QuoteError } from "../adapter-error";
import type { CdpWalletManager } from "../cdp/cdp-wallet-manager";
import {
  adaptiveDeliver,
  buildDeliveryPlan,
  buildProtocolResult,
} from "./x402-delivery";
import {
  extractPaymentInfo,
  negotiatePayment,
  type PaymentRequiredResponse,
} from "./x402-parsing";
import {
  buildAllAccepts,
  buildInputHints,
  resolvePrimaryQuote,
} from "./x402-quote-builder";

const DETECTION_TIMEOUT_MS = 10_000;
const QUOTE_TIMEOUT_MS = 15_000;
const DELIVERY_TIMEOUT_MS = 30_000;

export class X402Adapter implements ProtocolAdapter {
  readonly name = "x402";

  constructor(
    private readonly walletManager: CdpWalletManager | undefined,
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
      throw new X402QuoteError(`Cannot reach endpoint: ${msg}`);
    }
    if (response.status !== 402) {
      return false;
    }
    try {
      const info = await extractPaymentInfo(response);
      return info !== null;
    } catch {
      return false;
    }
  }

  async quote(
    url: string,
    headers?: Record<string, string>,
  ): Promise<ProtocolQuote> {
    this.validateUrl(url);

    const response = await this.fetchForQuote(url, headers);
    const paymentRequired = await this.parsePaymentRequired(response);
    const allAccepts = buildAllAccepts(paymentRequired.accepts);
    const primary = resolvePrimaryQuote(allAccepts, paymentRequired.accepts);
    const inputHints = buildInputHints(paymentRequired.metadata);

    return {
      amount: Money.fromCents(primary.cents),
      protocol: "x402",
      network: primary.network,
      payTo: primary.payTo,
      allAccepts: allAccepts.length > 0 ? allAccepts : undefined,
      inputHints,
    };
  }

  async quoteFromResponse(response: Response): Promise<ProtocolQuote | null> {
    if (response.status !== 402) return null;
    try {
      const paymentRequired = await extractPaymentInfo(response);
      if (!paymentRequired || paymentRequired.accepts.length === 0) return null;
      const allAccepts = buildAllAccepts(paymentRequired.accepts);
      const primary = resolvePrimaryQuote(allAccepts, paymentRequired.accepts);
      const inputHints = buildInputHints(paymentRequired.metadata);
      return {
        amount: Money.fromCents(primary.cents),
        protocol: "x402",
        network: primary.network,
        payTo: primary.payTo,
        allAccepts: allAccepts.length > 0 ? allAccepts : undefined,
        inputHints,
      };
    } catch {
      return null;
    }
  }

  private async fetchForQuote(
    url: string,
    headers?: Record<string, string>,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      throw new X402QuoteError(`Failed to reach endpoint: ${msg}`);
    }
    if (response.status !== 402) {
      throw new X402QuoteError(`Expected 402 status, got ${response.status}`);
    }
    return response;
  }

  private async parsePaymentRequired(
    response: Response,
  ): Promise<PaymentRequiredResponse> {
    let paymentRequired: PaymentRequiredResponse | null;
    try {
      paymentRequired = await extractPaymentInfo(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Parse error";
      throw new X402QuoteError(`Failed to parse payment info: ${msg}`);
    }
    if (!paymentRequired) {
      throw new X402QuoteError(
        "No x402 payment information found in 402 response (checked V2 header, www-authenticate, and V1 body)",
      );
    }
    if (paymentRequired.accepts.length === 0) {
      throw new X402QuoteError("No payment options in x402 response");
    }
    return paymentRequired;
  }

  private async initializeX402Signing(): Promise<{
    readonly signPayment: (paymentRequired: unknown) => Promise<unknown>;
    readonly safeFetch: typeof fetch;
  }> {
    if (!this.walletManager) {
      throw new X402PaymentError(
        "Coinbase wallet credentials required for x402 payments. Provide coinbaseApiKeyId, coinbaseApiKeySecret, and coinbaseWalletSecret.",
      );
    }
    const evmAccount = await this.walletManager.getOrProvisionEvmAccount();
    const { x402Client } = await import("@x402/core/client");
    const { registerExactEvmScheme } = await import("@x402/evm/exact/client");

    const client = new x402Client();
    registerExactEvmScheme(client, {
      signer: evmAccount as Parameters<
        typeof registerExactEvmScheme
      >[1]["signer"],
    });

    try {
      const svmSigner = await this.walletManager.getSvmSigner();
      const { registerExactSvmScheme } = await import("@x402/svm/exact/client");
      // CDP SVM signer -> x402 SVM signer type (structural match, branded differently)
      registerExactSvmScheme(client, {
        signer: svmSigner as Parameters<
          typeof registerExactSvmScheme
        >[1]["signer"],
      });
    } catch {
      // Solana not available — EVM-only mode (acceptable)
    }

    const safeFetch: typeof fetch = (input, init) => {
      if (input instanceof Request) {
        this.validateUrl(input.url);
        return fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
      }
      const url = input.toString();
      this.validateUrl(url);
      return fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
    };

    // Safe: callers validate raw protocol data via isPaymentRequiredShape
    const signPayment = (paymentRequired: unknown): Promise<unknown> =>
      client.createPaymentPayload(
        paymentRequired as Parameters<typeof client.createPaymentPayload>[0],
      );

    return { signPayment, safeFetch };
  }

  async execute(request: {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: Uint8Array | undefined;
    readonly amount: Money;
  }): Promise<ProtocolResult> {
    this.validateUrl(request.url);

    try {
      const { signPayment, safeFetch } = await this.initializeX402Signing();

      const firstResponse = await safeFetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body ? new Uint8Array(request.body) : undefined,
      });

      if (firstResponse.status !== 402) {
        return buildProtocolResult(firstResponse);
      }

      const negotiation = await negotiatePayment(firstResponse);
      if (!negotiation) {
        throw new X402PaymentError("No payment information in 402 response");
      }

      const plan = buildDeliveryPlan(negotiation, request.method);
      return await adaptiveDeliver({
        request,
        plan,
        negotiation,
        signPayment,
        safeFetch,
      });
    } catch (err) {
      if (err instanceof X402PaymentError) throw err;
      const msg = err instanceof Error ? err.message : "Unknown payment error";
      throw new X402PaymentError(msg);
    }
  }
}
