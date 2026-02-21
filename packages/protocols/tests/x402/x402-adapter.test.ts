import { Money } from "@boltzpay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { X402PaymentError, X402QuoteError } from "../../src/adapter-error";
import type { CdpWalletManager } from "../../src/cdp/cdp-wallet-manager";
import { X402Adapter } from "../../src/x402/x402-adapter";

const { mockCreatePaymentPayload } = vi.hoisted(() => ({
  mockCreatePaymentPayload: vi.fn(),
}));

vi.mock("@x402/core/client", () => ({
  // biome-ignore lint/complexity/useArrowFunction: constructor mock requires regular function
  x402Client: vi.fn().mockImplementation(function () {
    return { createPaymentPayload: mockCreatePaymentPayload };
  }),
}));

vi.mock("@x402/evm/exact/client", () => ({
  registerExactEvmScheme: vi.fn(),
}));

vi.mock("@x402/svm/exact/client", () => ({
  registerExactSvmScheme: vi.fn(),
}));

import * as x402EvmModule from "@x402/evm/exact/client";
import * as x402SvmModule from "@x402/svm/exact/client";

function makeMockWalletManager(opts?: {
  svmSignerFails?: boolean;
}): CdpWalletManager {
  const svmSignerFails = opts?.svmSignerFails ?? false;
  return {
    getOrProvisionEvmAccount: vi.fn().mockResolvedValue({
      address: "0x1234" as `0x${string}`,
      signTypedData: vi.fn(),
    }),
    getSvmSigner: svmSignerFails
      ? vi.fn().mockRejectedValue(new Error("Solana not available"))
      : vi.fn().mockResolvedValue({
          address: "SoLaNaAdDr3ss",
          signTransactions: vi.fn(),
        }),
    getOrProvisionSolanaAccount: vi.fn(),
    getBalances: vi.fn(),
    getAddresses: vi.fn(),
  } as unknown as CdpWalletManager;
}

function makeV2Header(
  amountAtomic: string,
  network = "eip155:84532",
  payTo = "0xabc",
): string {
  return btoa(
    JSON.stringify({
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network,
          amount: amountAtomic,
          asset: "0xusdc",
          payTo,
        },
      ],
    }),
  );
}

function makeMultiChainV2Header(accepts: Array<{
  scheme?: string;
  network: string;
  amount: string;
  asset?: string;
  payTo: string;
}>): string {
  return btoa(
    JSON.stringify({
      x402Version: 2,
      accepts: accepts.map((a) => ({
        scheme: a.scheme ?? "exact",
        network: a.network,
        amount: a.amount,
        asset: a.asset ?? "0xusdc",
        payTo: a.payTo,
      })),
    }),
  );
}

function makeV1Body(
  maxAmountRequired = "10000",
  network = "base-sepolia",
  payTo = "0xabc",
) {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network,
        maxAmountRequired,
        asset: "USDC",
        resource: "/api/premium",
        payTo,
        maxTimeoutSeconds: 30,
      },
    ],
    error: "missing payment header",
  };
}

function makeWwwAuthHeader(
  address = "0xD412fB3",
  amount = "0.01",
  chainId = "8453",
  token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
): string {
  return `x402 address="${address}", amount="${amount}", chainId="${chainId}", token="${token}"`;
}

function mock402Response(opts: {
  headers?: Headers;
  body?: unknown;
}) {
  const { headers = new Headers(), body } = opts;
  return {
    status: 402,
    headers,
    json: body !== undefined
      ? vi.fn().mockResolvedValue(body)
      : vi.fn().mockRejectedValue(new Error("no body")),
  };
}

function makeSuccessResponse(
  opts: {
    status?: number;
    ok?: boolean;
    txHash?: string;
    body?: Uint8Array;
  } = {},
): Response {
  const {
    status = 200,
    ok = true,
    txHash,
    body = new Uint8Array([1, 2, 3]),
  } = opts;
  const paymentResponseHeader = txHash
    ? btoa(
        JSON.stringify({
          success: true,
          transaction: txHash,
          network: "eip155:84532",
        }),
      )
    : undefined;
  const headers = new Headers();
  if (paymentResponseHeader) {
    headers.set("payment-response", paymentResponseHeader);
  }
  return {
    ok,
    status,
    headers,
    arrayBuffer: vi.fn().mockResolvedValue(body.buffer),
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;

describe("X402Adapter", () => {
  let adapter: X402Adapter;

  beforeEach(() => {
    adapter = new X402Adapter(makeMockWalletManager(), () => {});
    mockCreatePaymentPayload.mockReset();
    mockCreatePaymentPayload.mockResolvedValue({
      x402Version: 2,
      payload: { authorization: { mock: true }, signature: "0xmocksig" },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("detect — V2 (PAYMENT-REQUIRED header)", () => {
    it("should return true for 402 with valid V2 header", async () => {
      const header = makeV2Header("10000");
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(true);
    });

    it("should return false for 200 response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        json: vi.fn().mockRejectedValue(new Error("no body")),
      });

      expect(await adapter.detect("https://example.com/api")).toBe(false);
    });

    it("should return false for 402 without any payment info", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ body: { nothing: "here" } }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(false);
    });

    it("should throw X402QuoteError on network error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await expect(
        adapter.detect("https://example.com/api"),
      ).rejects.toThrow(X402QuoteError);
    });

    it("should throw when URL validator rejects (SSRF protection)", async () => {
      const ssrfAdapter = new X402Adapter(
        makeMockWalletManager(),
        (_url: string) => {
          throw new Error("SSRF blocked");
        },
      );

      await expect(
        ssrfAdapter.detect("http://internal.server"),
      ).rejects.toThrow("SSRF blocked");
    });
  });

  describe("detect — V1 (body JSON)", () => {
    it("should return true for 402 with V1 body (maxAmountRequired)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ body: makeV1Body() }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(true);
    });

    it("should return true for V1 body using amount field instead of maxAmountRequired", async () => {
      const v1WithAmount = {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "base-sepolia",
            amount: "50000",
            asset: "USDC",
            payTo: "0xabc",
          },
        ],
      };
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ body: v1WithAmount }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(true);
    });

    it("should return false for V1 body missing x402Version", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ body: { accepts: [{ amount: "1000", network: "base", payTo: "0x1" }] } }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(false);
    });

    it("should return false for V1 body with empty accepts", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ body: { x402Version: 1, accepts: [] } }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(false);
    });

    it("should return false for V1 body with accepts missing required fields", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          body: { x402Version: 1, accepts: [{ scheme: "exact" }] },
        }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(false);
    });

    it("should return false for non-JSON body", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 402,
        headers: new Headers(),
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
      });

      expect(await adapter.detect("https://example.com/api")).toBe(false);
    });
  });

  describe("detect — www-authenticate", () => {
    it("should return true for 402 with www-authenticate x402 header", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "www-authenticate": makeWwwAuthHeader() }),
          body: { nothing: "here" },
        }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(true);
    });

    it("should return false for www-authenticate without x402 scheme", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "www-authenticate": 'Bearer realm="example"' }),
          body: { nothing: "here" },
        }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(false);
    });

    it("should return true for www-authenticate with multiple challenges including x402", async () => {
      const multiChallenge = `Bearer realm="api", ${makeWwwAuthHeader()}`;
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "www-authenticate": multiChallenge }),
          body: { nothing: "here" },
        }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(true);
    });

    it("should return false for www-authenticate x402 missing address", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({
            "www-authenticate": 'x402 amount="0.01", chainId="8453"',
          }),
          body: { nothing: "here" },
        }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(false);
    });

    it("should return false for www-authenticate x402 missing amount", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({
            "www-authenticate": 'x402 address="0xabc", chainId="8453"',
          }),
          body: { nothing: "here" },
        }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(false);
    });
  });

  describe("detect — format priority cascade", () => {
    it("should prefer V2 header over V1 body", async () => {
      const header = makeV2Header("10000", "eip155:8453", "0xV2");
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "payment-required": header }),
          body: makeV1Body("99999", "base-sepolia", "0xV1"),
        }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(true);
    });

    it("should fall through malformed V2 to valid V1 body", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "payment-required": "not-valid-base64" }),
          body: makeV1Body(),
        }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(true);
    });

    it("should detect V1 payload inside V2 PAYMENT-REQUIRED header (hybrid servers)", async () => {
      const hybridHeader = btoa(
        JSON.stringify({
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "base",
              maxAmountRequired: "550000",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              payTo: "0xHybridPay",
              maxTimeoutSeconds: 90,
            },
          ],
        }),
      );
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "payment-required": hybridHeader }),
        }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(true);
    });

    it("should prefer www-authenticate over V1 body when no V2 header", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "www-authenticate": makeWwwAuthHeader() }),
          body: makeV1Body(),
        }),
      );

      expect(await adapter.detect("https://example.com/api")).toBe(true);
    });
  });

  describe("quote — V2 (PAYMENT-REQUIRED header)", () => {
    it("should parse V2 header and convert amount", async () => {
      const header = makeV2Header("1000000");
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      const quote = await adapter.quote("https://example.com/api");

      expect(quote.protocol).toBe("x402");
      expect(quote.amount.cents).toBe(100n);
      expect(quote.network).toBe("eip155:84532");
      expect(quote.payTo).toBe("0xabc");
    });

    it("should round up small amounts to minimum 1 cent", async () => {
      const header = makeV2Header("1");
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.amount.cents).toBe(1n);
    });

    it("should throw X402QuoteError for non-402 response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
      });

      await expect(adapter.quote("https://example.com/api")).rejects.toThrow(
        X402QuoteError,
      );
    });

    it("should throw X402QuoteError for 402 with no payment info at all", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ body: { unrelated: true } }),
      );

      await expect(adapter.quote("https://example.com/api")).rejects.toThrow(
        X402QuoteError,
      );
    });

    it("should throw X402QuoteError for empty accepts array in V2", async () => {
      const header = btoa(JSON.stringify({ x402Version: 2, accepts: [] }));
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      await expect(adapter.quote("https://example.com/api")).rejects.toThrow(
        X402QuoteError,
      );
    });

    it("should throw X402QuoteError for invalid amount string", async () => {
      const header = btoa(
        JSON.stringify({
          x402Version: 2,
          accepts: [
            {
              scheme: "exact",
              network: "eip155:84532",
              amount: "not-a-number",
              asset: "0xusdc",
              payTo: "0xabc",
            },
          ],
        }),
      );
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      await expect(adapter.quote("https://example.com/api")).rejects.toThrow(
        X402QuoteError,
      );
    });
  });

  describe("quote — V1 (body JSON)", () => {
    it("should parse V1 body with maxAmountRequired", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ body: makeV1Body("10000", "base-sepolia", "0xV1pay") }),
      );

      const quote = await adapter.quote("https://example.com/api");

      expect(quote.protocol).toBe("x402");
      expect(quote.amount.cents).toBe(1n);
      expect(quote.network).toBe("base-sepolia");
      expect(quote.payTo).toBe("0xV1pay");
    });

    it("should parse V1 body with large amount", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ body: makeV1Body("1000000", "base", "0xpay") }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.amount.cents).toBe(100n);
    });

    it("should throw for V1 body with invalid amount", async () => {
      const badV1 = {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "base-sepolia",
            maxAmountRequired: "abc",
            asset: "USDC",
            payTo: "0xabc",
          },
        ],
      };
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ body: badV1 }),
      );

      await expect(adapter.quote("https://example.com/api")).rejects.toThrow(
        X402QuoteError,
      );
    });
  });

  describe("quote — www-authenticate", () => {
    it("should parse www-authenticate and convert display amount to atomic", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({
            "www-authenticate": makeWwwAuthHeader("0xPayTo", "0.05", "8453"),
          }),
          body: { unrelated: true },
        }),
      );

      const quote = await adapter.quote("https://example.com/api");

      expect(quote.protocol).toBe("x402");
      expect(quote.amount.cents).toBe(5n);
      expect(quote.network).toBe("eip155:8453");
      expect(quote.payTo).toBe("0xPayTo");
    });

    it("should handle www-authenticate with $0.01 amount", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({
            "www-authenticate": makeWwwAuthHeader("0xAddr", "0.01", "8453"),
          }),
          body: { unrelated: true },
        }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.amount.cents).toBe(1n);
    });

    it("should handle www-authenticate with $1.00 amount", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({
            "www-authenticate": makeWwwAuthHeader("0xAddr", "1.00", "8453"),
          }),
          body: { unrelated: true },
        }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.amount.cents).toBe(100n);
    });

    it("should default to Base mainnet when chainId is missing", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({
            "www-authenticate": 'x402 address="0xAddr", amount="0.01"',
          }),
          body: { unrelated: true },
        }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.network).toBe("eip155:8453");
    });

    it("should reject www-authenticate with negative amount", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({
            "www-authenticate": 'x402 address="0xAddr", amount="-1.00"',
          }),
          body: { unrelated: true },
        }),
      );

      await expect(adapter.quote("https://example.com/api")).rejects.toThrow(
        X402QuoteError,
      );
    });

    it("should reject www-authenticate with excessively long amount (DoS guard)", async () => {
      const longAmount = "9".repeat(1000);
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({
            "www-authenticate": `x402 address="0xAddr", amount="${longAmount}"`,
          }),
          body: { unrelated: true },
        }),
      );

      await expect(adapter.quote("https://example.com/api")).rejects.toThrow(
        X402QuoteError,
      );
    });
  });

  describe("quote — format priority", () => {
    it("should prefer V2 header over V1 body", async () => {
      const header = makeV2Header("50000", "eip155:8453", "0xV2pay");
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "payment-required": header }),
          body: makeV1Body("99999", "base-sepolia", "0xV1pay"),
        }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.payTo).toBe("0xV2pay");
      expect(quote.network).toBe("eip155:8453");
    });

    it("should fall through malformed V2 to valid V1 body", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "payment-required": "garbage" }),
          body: makeV1Body("10000", "base-sepolia", "0xV1fallback"),
        }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.payTo).toBe("0xV1fallback");
      expect(quote.network).toBe("base-sepolia");
    });

    it("should parse V1 payload inside V2 header (hybrid emc2ai-style)", async () => {
      const hybridHeader = btoa(
        JSON.stringify({
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "base",
              maxAmountRequired: "550000",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              payTo: "0xHybridPay",
              maxTimeoutSeconds: 90,
            },
          ],
        }),
      );
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "payment-required": hybridHeader }),
        }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.protocol).toBe("x402");
      expect(quote.amount.cents).toBe(55n);
      expect(quote.network).toBe("base");
      expect(quote.payTo).toBe("0xHybridPay");
    });
  });

  describe("quote — allAccepts (multi-chain)", () => {
    it("should return allAccepts with 1 entry for single V2 accept", async () => {
      const header = makeV2Header("1000000", "eip155:8453", "0xpay");
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.allAccepts).toBeDefined();
      expect(quote.allAccepts).toHaveLength(1);
      const firstAccept = quote.allAccepts?.[0];
      expect(firstAccept).toBeDefined();
      expect(firstAccept?.namespace).toBe("evm");
      expect(firstAccept?.network).toBe("eip155:8453");
      expect(firstAccept?.amount).toBe(100n); // 1000000 atomic = 100 cents
      expect(firstAccept?.payTo).toBe("0xpay");
      expect(firstAccept?.scheme).toBe("exact");
    });

    it("should return allAccepts with 2 entries for EVM + SVM V2 response", async () => {
      const header = makeMultiChainV2Header([
        { network: "eip155:8453", amount: "1000000", payTo: "0xEvmPay" },
        { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: "500000", payTo: "SolPay123" },
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.allAccepts).toBeDefined();
      expect(quote.allAccepts).toHaveLength(2);

      const evmAccept = quote.allAccepts?.[0];
      expect(evmAccept).toBeDefined();
      expect(evmAccept?.namespace).toBe("evm");
      expect(evmAccept?.network).toBe("eip155:8453");
      expect(evmAccept?.amount).toBe(100n); // 1000000 atomic = 100 cents
      expect(evmAccept?.payTo).toBe("0xEvmPay");

      const svmAccept = quote.allAccepts?.[1];
      expect(svmAccept).toBeDefined();
      expect(svmAccept?.namespace).toBe("svm");
      expect(svmAccept?.network).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
      expect(svmAccept?.amount).toBe(50n); // 500000 atomic = 50 cents
      expect(svmAccept?.payTo).toBe("SolPay123");
    });

    it("should skip accept with unknown chain namespace and return valid ones", async () => {
      const header = makeMultiChainV2Header([
        { network: "eip155:8453", amount: "1000000", payTo: "0xEvmPay" },
        { network: "cosmos:cosmoshub-4", amount: "500000", payTo: "cosmosPay" },
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      const quote = await adapter.quote("https://example.com/api");
      expect(quote.allAccepts).toBeDefined();
      expect(quote.allAccepts).toHaveLength(1);
      const onlyAccept = quote.allAccepts?.[0];
      expect(onlyAccept).toBeDefined();
      expect(onlyAccept?.namespace).toBe("evm");
    });

    it("should correctly parse namespace from network string", async () => {
      const solanaGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
      const header = makeMultiChainV2Header([
        { network: "eip155:8453", amount: "100000", payTo: "0xEvm" },
        { network: `solana:${solanaGenesis}`, amount: "200000", payTo: "Sol1" },
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      const quote = await adapter.quote("https://example.com/api");
      const evmEntry = quote.allAccepts?.[0];
      const svmEntry = quote.allAccepts?.[1];
      expect(evmEntry).toBeDefined();
      expect(svmEntry).toBeDefined();
      expect(evmEntry?.namespace).toBe("evm");
      expect(svmEntry?.namespace).toBe("svm");
    });

    it("should have bigint amount in cents in allAccepts entries", async () => {
      const header = makeV2Header("12345678", "eip155:8453", "0xpay");
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      const quote = await adapter.quote("https://example.com/api");
      const entry = quote.allAccepts?.[0];
      expect(entry).toBeDefined();
      expect(typeof entry?.amount).toBe("bigint");
      // 12345678 atomic / 10000 = 1234.5678 → ceiling to 1235 cents
      expect(entry?.amount).toBe(1235n);
    });

    it("should return allAccepts undefined for V1 body with non-CAIP network", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ body: makeV1Body("10000", "base-sepolia", "0xV1") }),
      );

      const quote = await adapter.quote("https://example.com/api");
      // V1 "base-sepolia" is not a valid CAIP-2 identifier, so allAccepts is undefined
      expect(quote.allAccepts).toBeUndefined();
    });

    it("should preserve backward compat: amount/network/payTo from primary accept", async () => {
      const header = makeMultiChainV2Header([
        { network: "eip155:8453", amount: "1000000", payTo: "0xFirst" },
        { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: "500000", payTo: "SolSecond" },
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({ headers: new Headers({ "payment-required": header }) }),
      );

      const quote = await adapter.quote("https://example.com/api");
      // Primary accept = first valid
      expect(quote.amount.cents).toBe(100n); // 1000000 atomic = 100 cents
      expect(quote.network).toBe("eip155:8453");
      expect(quote.payTo).toBe("0xFirst");
    });
  });

  describe("quoteFromResponse()", () => {
    it("should extract quote from 402 with V2 payment-required header", async () => {
      const header = makeV2Header("1000000", "eip155:8453", "0xpay");
      const response = new Response(null, {
        status: 402,
        headers: { "payment-required": header },
      });

      const quote = await adapter.quoteFromResponse(response);

      expect(quote).not.toBeNull();
      expect(quote!.protocol).toBe("x402");
      expect(quote!.amount.cents).toBe(100n);
      expect(quote!.network).toBe("eip155:8453");
      expect(quote!.payTo).toBe("0xpay");
    });

    it("should extract quote from 402 with www-authenticate x402 header", async () => {
      const response = new Response(null, {
        status: 402,
        headers: {
          "www-authenticate": makeWwwAuthHeader("0xAddr", "0.05", "8453"),
        },
      });

      const quote = await adapter.quoteFromResponse(response);

      expect(quote).not.toBeNull();
      expect(quote!.protocol).toBe("x402");
      expect(quote!.amount.cents).toBe(5n);
      expect(quote!.network).toBe("eip155:8453");
    });

    it("should extract quote from 402 with V1 body", async () => {
      const v1Body = makeV1Body("1000000", "base-sepolia", "0xV1pay");
      const response = new Response(JSON.stringify(v1Body), {
        status: 402,
        headers: { "content-type": "application/json" },
      });

      const quote = await adapter.quoteFromResponse(response);

      expect(quote).not.toBeNull();
      expect(quote!.protocol).toBe("x402");
      expect(quote!.payTo).toBe("0xV1pay");
    });

    it("should return null for non-402 response", async () => {
      const response = new Response("ok", { status: 200 });
      const quote = await adapter.quoteFromResponse(response);
      expect(quote).toBeNull();
    });

    it("should return null for 402 without any x402 payment info", async () => {
      const response = new Response(JSON.stringify({ unrelated: true }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
      const quote = await adapter.quoteFromResponse(response);
      expect(quote).toBeNull();
    });

    it("should return allAccepts for multi-chain V2 response", async () => {
      const header = makeMultiChainV2Header([
        { network: "eip155:8453", amount: "1000000", payTo: "0xEvm" },
        { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: "500000", payTo: "Sol1" },
      ]);
      const response = new Response(null, {
        status: 402,
        headers: { "payment-required": header },
      });

      const quote = await adapter.quoteFromResponse(response);

      expect(quote).not.toBeNull();
      expect(quote!.allAccepts).toHaveLength(2);
    });

    it("should not make any HTTP requests", async () => {
      const header = makeV2Header("10000");
      const response = new Response(null, {
        status: 402,
        headers: { "payment-required": header },
      });
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      await adapter.quoteFromResponse(response);

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("execute — V2 payment flow", () => {
    it("should complete V2 payment: first fetch 402, sign, second fetch 200", async () => {
      const v2Header = makeV2Header("10000");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse({ txHash: "0xtx123" }));
      globalThis.fetch = fetchMock;

      const result = await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      expect(result.success).toBe(true);
      expect(result.externalTxHash).toBe("0xtx123");
      expect(result.responseStatus).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("should send PAYMENT-SIGNATURE header for V2 payment", async () => {
      const v2Header = makeV2Header("10000");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      const secondCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
      const headers = secondCallInit.headers as Record<string, string>;
      expect(headers["PAYMENT-SIGNATURE"]).toBeDefined();
      expect(headers["X-PAYMENT"]).toBeUndefined();
    });

    it("should pass raw V2 data to createPaymentPayload", async () => {
      const v2Header = makeV2Header("10000", "eip155:8453", "0xpay");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      expect(mockCreatePaymentPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          x402Version: 2,
          accepts: expect.arrayContaining([
            expect.objectContaining({ amount: "10000", payTo: "0xpay" }),
          ]),
        }),
      );
    });

    it("should forward user headers and method to both fetches", async () => {
      const v2Header = makeV2Header("10000");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      await adapter.execute({
        url: "https://example.com/api",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array([10, 20]),
        amount: Money.fromCents(200n),
      });

      const firstCallInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(firstCallInit.method).toBe("POST");
      expect((firstCallInit.headers as Record<string, string>)["content-type"]).toBe("application/json");

      const secondCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
      expect(secondCallInit.method).toBe("POST");
      expect((secondCallInit.headers as Record<string, string>)["content-type"]).toBe("application/json");
    });
  });

  describe("execute — V1-in-V2 hybrid payment flow (BUG 1 fix)", () => {
    it("should handle V1 data in PAYMENT-REQUIRED header (emc2-style)", async () => {
      const hybridHeader = btoa(
        JSON.stringify({
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "base",
              maxAmountRequired: "550000",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              payTo: "0xHybridPay",
              maxTimeoutSeconds: 90,
              extra: { name: "USD Coin", version: "2" },
            },
          ],
        }),
      );
      mockCreatePaymentPayload.mockResolvedValue({
        x402Version: 1,
        scheme: "exact",
        network: "base",
        payload: { authorization: { mock: true }, signature: "0xv1sig" },
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": hybridHeader }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse({ txHash: "0xtxhybrid" }));
      globalThis.fetch = fetchMock;

      const result = await adapter.execute({
        url: "https://emc2ai.io/x402/bitquery/top-tokens",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(55n),
      });

      expect(result.success).toBe(true);
      expect(result.externalTxHash).toBe("0xtxhybrid");
    });

    it("should pass raw V1 data with maxAmountRequired to createPaymentPayload", async () => {
      const hybridHeader = btoa(
        JSON.stringify({
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "base",
              maxAmountRequired: "550000",
              asset: "0xUSDC",
              payTo: "0xHybridPay",
              maxTimeoutSeconds: 90,
            },
          ],
        }),
      );
      mockCreatePaymentPayload.mockResolvedValue({ x402Version: 1, payload: {} });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": hybridHeader }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(55n),
      });

      // V1 raw data preserved — maxAmountRequired NOT normalized to amount
      expect(mockCreatePaymentPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          x402Version: 1,
          accepts: expect.arrayContaining([
            expect.objectContaining({ maxAmountRequired: "550000" }),
          ]),
        }),
      );
    });

    it("should use X-PAYMENT header for hybrid (V1 data version, not V2 transport)", async () => {
      const hybridHeader = btoa(
        JSON.stringify({
          x402Version: 1,
          accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "100000", asset: "USDC", payTo: "0x1", maxTimeoutSeconds: 30 }],
        }),
      );
      mockCreatePaymentPayload.mockResolvedValue({ x402Version: 1, payload: {} });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": hybridHeader }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(10n),
      });

      // V1 data version → X-PAYMENT (even though transport was PAYMENT-REQUIRED header)
      const secondCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
      const headers = secondCallInit.headers as Record<string, string>;
      expect(headers["X-PAYMENT"]).toBeDefined();
      expect(headers["PAYMENT-SIGNATURE"]).toBeUndefined();
    });
  });

  describe("execute — V1 body payment flow", () => {
    it("should handle V1 body payment and send X-PAYMENT header", async () => {
      const v1Body = makeV1Body("10000", "base-sepolia", "0xV1pay");
      mockCreatePaymentPayload.mockResolvedValue({
        x402Version: 1,
        scheme: "exact",
        network: "base-sepolia",
        payload: { authorization: { mock: true }, signature: "0xv1bodysig" },
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers(),
          json: vi.fn().mockResolvedValue(v1Body),
        })
        .mockResolvedValueOnce(makeSuccessResponse({ txHash: "0xtxv1" }));
      globalThis.fetch = fetchMock;

      const result = await adapter.execute({
        url: "https://example.com/api",
        method: "POST",
        headers: {},
        body: undefined,
        amount: Money.fromCents(1n),
      });

      expect(result.success).toBe(true);
      expect(result.externalTxHash).toBe("0xtxv1");

      // V1 body transport → X-PAYMENT header (not PAYMENT-SIGNATURE)
      const secondCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
      const headers = secondCallInit.headers as Record<string, string>;
      expect(headers["X-PAYMENT"]).toBeDefined();
      expect(headers["PAYMENT-SIGNATURE"]).toBeUndefined();
    });
  });

  describe("execute — non-402 passthrough", () => {
    it("should return directly when first response is not 402", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      });
      globalThis.fetch = fetchMock;

      const result = await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      expect(result.success).toBe(true);
      expect(result.responseStatus).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(mockCreatePaymentPayload).not.toHaveBeenCalled();
    });
  });

  describe("execute — error handling", () => {
    it("should throw X402PaymentError when no payment info in 402", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        status: 402,
        ok: false,
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({ unrelated: true }),
      });
      globalThis.fetch = fetchMock;

      await expect(
        adapter.execute({
          url: "https://example.com/api",
          method: "GET",
          headers: {},
          body: undefined,
          amount: Money.fromCents(100n),
        }),
      ).rejects.toThrow(X402PaymentError);
    });

    it("should throw X402PaymentError when signing fails", async () => {
      const v2Header = makeV2Header("10000");
      mockCreatePaymentPayload.mockRejectedValue(new Error("No scheme registered"));
      const fetchMock = vi.fn().mockResolvedValueOnce({
        status: 402,
        ok: false,
        headers: new Headers({ "payment-required": v2Header }),
        json: vi.fn().mockResolvedValue({}),
      });
      globalThis.fetch = fetchMock;

      await expect(
        adapter.execute({
          url: "https://example.com/api",
          method: "GET",
          headers: {},
          body: undefined,
          amount: Money.fromCents(100n),
        }),
      ).rejects.toThrow(X402PaymentError);
    });

    it("should re-throw X402PaymentError unchanged", async () => {
      const v2Header = makeV2Header("10000");
      const originalError = new X402PaymentError("Insufficient funds");
      mockCreatePaymentPayload.mockRejectedValue(originalError);
      const fetchMock = vi.fn().mockResolvedValueOnce({
        status: 402,
        ok: false,
        headers: new Headers({ "payment-required": v2Header }),
        json: vi.fn().mockResolvedValue({}),
      });
      globalThis.fetch = fetchMock;

      await expect(
        adapter.execute({
          url: "https://example.com/api",
          method: "GET",
          headers: {},
          body: undefined,
          amount: Money.fromCents(100n),
        }),
      ).rejects.toThrow(originalError);
    });

    it("should return success false when server rejects with non-retryable status", async () => {
      const v2Header = makeV2Header("10000");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse({ status: 403, ok: false }));
      globalThis.fetch = fetchMock;

      const result = await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      expect(result.success).toBe(false);
      expect(result.responseStatus).toBe(403);
    });

    it("should throw after exhausting retries when server always returns 402", async () => {
      const v2Header = makeV2Header("10000");
      mockCreatePaymentPayload.mockResolvedValue({ x402Version: 2, payload: {} });
      const make402 = () => ({
        status: 402,
        ok: false,
        headers: new Headers(),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make402())
        .mockResolvedValueOnce(make402());
      globalThis.fetch = fetchMock;

      await expect(
        adapter.execute({
          url: "https://example.com/api",
          method: "GET",
          headers: {},
          body: undefined,
          amount: Money.fromCents(100n),
        }),
      ).rejects.toThrow(/delivery attempts/);
    });

    it("should throw X402PaymentError when wallet credentials are missing", async () => {
      const noWalletAdapter = new X402Adapter(undefined, () => {});

      await expect(
        noWalletAdapter.execute({
          url: "https://example.com/api",
          method: "GET",
          headers: {},
          body: undefined,
          amount: Money.fromCents(100n),
        }),
      ).rejects.toThrow(X402PaymentError);
    });
  });

  describe("execute — adaptive delivery", () => {
    it("should retry with POST when GET returns 405", async () => {
      const v2Header = makeV2Header("10000");
      mockCreatePaymentPayload.mockResolvedValue({ x402Version: 2, payload: {} });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        // First paid attempt: GET → 405
        .mockResolvedValueOnce({
          status: 405,
          ok: false,
          headers: new Headers(),
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        })
        // Second paid attempt: POST → 200
        .mockResolvedValueOnce(makeSuccessResponse({ txHash: "0xRetried" }));
      globalThis.fetch = fetchMock;

      const result = await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      expect(result.success).toBe(true);
      expect(result.externalTxHash).toBe("0xRetried");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      // Second attempt should be POST
      const retryInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
      expect(retryInit.method).toBe("POST");
    });

    it("should re-sign when method changes after 405", async () => {
      const v2Header = makeV2Header("10000");
      mockCreatePaymentPayload.mockResolvedValue({ x402Version: 2, payload: {} });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        // GET + PAYMENT-SIGNATURE → 405
        .mockResolvedValueOnce({
          status: 405,
          ok: false,
          headers: new Headers(),
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        })
        // POST + PAYMENT-SIGNATURE → 200 (re-signed due to method change)
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      // 405 triggers method change (GET→POST) → re-sign for fresh nonce
      expect(mockCreatePaymentPayload).toHaveBeenCalledTimes(2);
    });

    it("should re-sign on 400 (nonce may be consumed)", async () => {
      const v2Header = makeV2Header("10000");
      mockCreatePaymentPayload.mockResolvedValue({ x402Version: 2, payload: {} });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        // First attempt: 400 (nonce may be consumed)
        .mockResolvedValueOnce({
          status: 400,
          ok: false,
          headers: new Headers(),
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        })
        // Second attempt: success
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      // 400 = nonce unsafe → signed twice (initial + re-sign)
      expect(mockCreatePaymentPayload).toHaveBeenCalledTimes(2);
    });

    it("should throw descriptive error when all attempts fail", async () => {
      const v2Header = makeV2Header("10000");
      mockCreatePaymentPayload.mockResolvedValue({ x402Version: 2, payload: {} });

      const make405 = () => ({
        status: 405,
        ok: false,
        headers: new Headers(),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(make405())
        .mockResolvedValueOnce(make405())
        .mockResolvedValueOnce(make405());
      globalThis.fetch = fetchMock;

      await expect(
        adapter.execute({
          url: "https://example.com/api",
          method: "GET",
          headers: {},
          body: undefined,
          amount: Money.fromCents(100n),
        }),
      ).rejects.toThrow(/delivery attempts/);
    });

    it("should handle www-authenticate in execute path", async () => {
      mockCreatePaymentPayload.mockResolvedValue({ x402Version: 2, payload: {} });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({
            "www-authenticate": 'x402 address="0xPay" amount="0.01" chainId="8453"',
          }),
          json: vi.fn().mockRejectedValue(new Error("no body")),
        })
        .mockResolvedValueOnce(makeSuccessResponse({ txHash: "0xWwwAuth" }));
      globalThis.fetch = fetchMock;

      const result = await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(1n),
      });

      expect(result.success).toBe(true);
      expect(result.externalTxHash).toBe("0xWwwAuth");

      // www-authenticate normalizes to V2 → PAYMENT-SIGNATURE header
      const secondCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
      const headers = secondCallInit.headers as Record<string, string>;
      expect(headers["PAYMENT-SIGNATURE"]).toBeDefined();
    });

    it("should retry when paid request returns 402 again (server did not see payment)", async () => {
      const v1Body = makeV1Body("10000", "base-sepolia", "0xPay");
      mockCreatePaymentPayload.mockResolvedValue({ x402Version: 1, payload: {} });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers(),
          json: vi.fn().mockResolvedValue(v1Body),
        })
        // V1 + GET → delivery plan is [POST, GET, GET]. First: POST + X-PAYMENT → 402
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers(),
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        })
        // Second attempt: GET + X-PAYMENT → 200 (method changed → re-signed)
        .mockResolvedValueOnce(makeSuccessResponse({ txHash: "0x402Retry" }));
      globalThis.fetch = fetchMock;

      const result = await adapter.execute({
        url: "https://example.com/api/create",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      expect(result.success).toBe(true);
      expect(result.externalTxHash).toBe("0x402Retry");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      // Method changed POST→GET → re-signed (2 total signatures)
      expect(mockCreatePaymentPayload).toHaveBeenCalledTimes(2);
    });

    it("should not retry when user explicitly uses POST", async () => {
      const v1Body = makeV1Body("10000", "base-sepolia", "0xPay");
      mockCreatePaymentPayload.mockResolvedValue({ x402Version: 1, payload: {} });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers(),
          json: vi.fn().mockResolvedValue(v1Body),
        })
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      await adapter.execute({
        url: "https://example.com/api",
        method: "POST",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      // POST user → plan is [POST+X-PAYMENT, POST+PAYMENT-SIGNATURE]
      // First attempt succeeds → only 2 fetch calls
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("execute — settlement parsing", () => {
    it("should extract externalTxHash from payment-response header", async () => {
      const v2Header = makeV2Header("10000");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse({ txHash: "0xSettled" }));
      globalThis.fetch = fetchMock;

      const result = await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      expect(result.externalTxHash).toBe("0xSettled");
    });

    it("should return undefined externalTxHash when payment-response header is absent", async () => {
      const v2Header = makeV2Header("10000");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      const result = await adapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      });

      expect(result.externalTxHash).toBeUndefined();
    });
  });

  describe("SVM scheme registration", () => {
    beforeEach(() => {
      vi.mocked(x402EvmModule.registerExactEvmScheme).mockClear();
      vi.mocked(x402SvmModule.registerExactSvmScheme).mockClear();
    });

    it("should register SVM scheme when getSvmSigner() succeeds", async () => {
      const walletManager = makeMockWalletManager({ svmSignerFails: false });
      const svmAdapter = new X402Adapter(walletManager, () => {});

      const v2Header = makeV2Header("10000");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      await svmAdapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(10n),
      });

      // EVM scheme always registered
      expect(x402EvmModule.registerExactEvmScheme).toHaveBeenCalledTimes(1);
      // SVM scheme registered since signer is available
      expect(x402SvmModule.registerExactSvmScheme).toHaveBeenCalledTimes(1);
    });

    it("should work in EVM-only mode when getSvmSigner() throws", async () => {
      const walletManager = makeMockWalletManager({ svmSignerFails: true });
      const evmOnlyAdapter = new X402Adapter(walletManager, () => {});

      const v2Header = makeV2Header("10000");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      const result = await evmOnlyAdapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(10n),
      });

      expect(result.success).toBe(true);
      // EVM scheme registered
      expect(x402EvmModule.registerExactEvmScheme).toHaveBeenCalledTimes(1);
      // SVM scheme NOT registered (signer failed)
      expect(x402SvmModule.registerExactSvmScheme).not.toHaveBeenCalled();
    });

    it("should call getOrProvisionEvmAccount on walletManager", async () => {
      const walletManager = makeMockWalletManager();
      const testAdapter = new X402Adapter(walletManager, () => {});

      const v2Header = makeV2Header("10000");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce(makeSuccessResponse());
      globalThis.fetch = fetchMock;

      await testAdapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(10n),
      });

      expect(walletManager.getOrProvisionEvmAccount).toHaveBeenCalled();
      expect(walletManager.getSvmSigner).toHaveBeenCalled();
    });
  });
});
