import { Money } from "@boltzpay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function makeMultiChainV2Header(
  accepts: Array<{
    scheme?: string;
    network: string;
    amount: string;
    asset?: string;
    payTo: string;
  }>,
): string {
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

function mock402Response(opts: { headers?: Headers; body?: unknown }) {
  const { headers = new Headers(), body } = opts;
  return {
    status: 402,
    headers,
    json:
      body !== undefined
        ? vi.fn().mockResolvedValue(body)
        : vi.fn().mockRejectedValue(new Error("no body")),
  };
}

const originalFetch = globalThis.fetch;

describe("X402Adapter multi-chain integration", () => {
  let adapter: X402Adapter;

  beforeEach(() => {
    adapter = new X402Adapter(makeMockWalletManager(), () => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("quote() with V2 multi-chain response (EVM + SVM)", () => {
    it("returns allAccepts with 2 entries for EVM + SVM accepts", async () => {
      const header = makeMultiChainV2Header([
        { network: "eip155:8453", amount: "5000000", payTo: "0xEvmPay" },
        {
          network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          amount: "3000000",
          payTo: "SolPay789",
        },
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "payment-required": header }),
        }),
      );

      const quote = await adapter.quote("https://multi-chain.api/data");

      expect(quote.allAccepts).toBeDefined();
      expect(quote.allAccepts).toHaveLength(2);
      // First accept: EVM
      const evmAccept = quote.allAccepts?.[0];
      expect(evmAccept).toBeDefined();
      expect(evmAccept?.namespace).toBe("evm");
      expect(evmAccept?.network).toBe("eip155:8453");
      expect(evmAccept?.amount).toBe(500n); // 5000000 atomic = 500 cents
      expect(evmAccept?.payTo).toBe("0xEvmPay");
      expect(evmAccept?.scheme).toBe("exact");
      // Second accept: SVM
      const svmAccept = quote.allAccepts?.[1];
      expect(svmAccept).toBeDefined();
      expect(svmAccept?.namespace).toBe("svm");
      expect(svmAccept?.network).toBe(
        "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      );
      expect(svmAccept?.amount).toBe(300n); // 3000000 atomic = 300 cents
      expect(svmAccept?.payTo).toBe("SolPay789");
    });

    it("primary quote uses first valid accept (EVM) as backward compat", async () => {
      const header = makeMultiChainV2Header([
        { network: "eip155:8453", amount: "5000000", payTo: "0xEvmFirst" },
        {
          network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          amount: "3000000",
          payTo: "SolSecond",
        },
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "payment-required": header }),
        }),
      );

      const quote = await adapter.quote("https://multi-chain.api/data");

      // Primary amount/network/payTo come from first valid accept
      expect(quote.amount.cents).toBe(500n); // 5000000 atomic USDC = 500 cents
      expect(quote.network).toBe("eip155:8453");
      expect(quote.payTo).toBe("0xEvmFirst");
    });
  });

  describe("quote() with V2 single-chain response", () => {
    it("returns allAccepts with 1 entry for EVM-only V2 accept", async () => {
      const header = makeMultiChainV2Header([
        { network: "eip155:8453", amount: "1000000", payTo: "0xSinglePay" },
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "payment-required": header }),
        }),
      );

      const quote = await adapter.quote("https://evm-only.api/data");

      expect(quote.allAccepts).toBeDefined();
      expect(quote.allAccepts).toHaveLength(1);
      const onlyAccept = quote.allAccepts?.[0];
      expect(onlyAccept).toBeDefined();
      expect(onlyAccept?.namespace).toBe("evm");
      expect(onlyAccept?.network).toBe("eip155:8453");
    });
  });

  describe("quote() with V1 response", () => {
    it("returns allAccepts undefined for V1 with non-CAIP network", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          body: makeV1Body("10000", "base-sepolia", "0xV1Pay"),
        }),
      );

      const quote = await adapter.quote("https://v1.api/legacy");

      // V1 "base-sepolia" is not a valid CAIP-2 identifier
      expect(quote.allAccepts).toBeUndefined();
      // But primary quote still works
      expect(quote.amount.cents).toBe(1n);
      expect(quote.network).toBe("base-sepolia");
      expect(quote.payTo).toBe("0xV1Pay");
    });

    it("returns allAccepts with parsed entries when V1 uses CAIP-2 networks", async () => {
      const v1WithCaip = {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453",
            amount: "1000000",
            asset: "USDC",
            payTo: "0xCaipV1Pay",
          },
        ],
      };
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mock402Response({ body: v1WithCaip }));

      const quote = await adapter.quote("https://v1-caip.api/data");

      // V1 with valid CAIP-2 should have allAccepts
      expect(quote.allAccepts).toBeDefined();
      expect(quote.allAccepts).toHaveLength(1);
      const firstAccept = quote.allAccepts?.[0];
      expect(firstAccept).toBeDefined();
      expect(firstAccept?.namespace).toBe("evm");
    });
  });

  describe("initializeX402Signing — scheme registration", () => {
    function makeV2Header(): string {
      return btoa(
        JSON.stringify({
          x402Version: 2,
          accepts: [{ scheme: "exact", network: "eip155:8453", amount: "10000", asset: "0xusdc", payTo: "0xabc" }],
        }),
      );
    }

    beforeEach(() => {
      vi.mocked(x402EvmModule.registerExactEvmScheme).mockClear();
      vi.mocked(x402SvmModule.registerExactSvmScheme).mockClear();
      mockCreatePaymentPayload.mockReset();
      mockCreatePaymentPayload.mockResolvedValue({
        x402Version: 2,
        payload: { authorization: { mock: true }, signature: "0xmock" },
      });
    });

    it("registers both EVM and SVM schemes when wallet manager provides both", async () => {
      const walletManager = makeMockWalletManager({ svmSignerFails: false });
      const multiAdapter = new X402Adapter(walletManager, () => {});

      const v2Header = makeV2Header();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402, ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          headers: new Headers(),
          arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
        });
      globalThis.fetch = fetchMock;

      await multiAdapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(10n),
      });

      expect(x402EvmModule.registerExactEvmScheme).toHaveBeenCalledTimes(1);
      expect(x402SvmModule.registerExactSvmScheme).toHaveBeenCalledTimes(1);
      expect(walletManager.getOrProvisionEvmAccount).toHaveBeenCalled();
      expect(walletManager.getSvmSigner).toHaveBeenCalled();
    });

    it("registers only EVM when getSvmSigner throws", async () => {
      const walletManager = makeMockWalletManager({ svmSignerFails: true });
      const evmOnlyAdapter = new X402Adapter(walletManager, () => {});

      const v2Header = makeV2Header();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          status: 402, ok: false,
          headers: new Headers({ "payment-required": v2Header }),
          json: vi.fn().mockResolvedValue({}),
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          headers: new Headers(),
          arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
        });
      globalThis.fetch = fetchMock;

      const result = await evmOnlyAdapter.execute({
        url: "https://example.com/api",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(10n),
      });

      expect(result.success).toBe(true);
      expect(x402EvmModule.registerExactEvmScheme).toHaveBeenCalledTimes(1);
      expect(x402SvmModule.registerExactSvmScheme).not.toHaveBeenCalled();
    });
  });

  describe("quote() skips invalid chain namespaces gracefully", () => {
    it("parses only known chains and skips unknown namespace accepts", async () => {
      const header = makeMultiChainV2Header([
        { network: "eip155:8453", amount: "1000000", payTo: "0xEvmPay" },
        {
          network: "cosmos:cosmoshub-4",
          amount: "500000",
          payTo: "cosmosPay",
        },
        {
          network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          amount: "800000",
          payTo: "SolPay",
        },
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(
        mock402Response({
          headers: new Headers({ "payment-required": header }),
        }),
      );

      const quote = await adapter.quote("https://multi-mixed.api/data");

      // cosmos is not a known namespace, should be skipped
      expect(quote.allAccepts).toBeDefined();
      expect(quote.allAccepts).toHaveLength(2);
      const evmEntry = quote.allAccepts?.[0];
      const svmEntry = quote.allAccepts?.[1];
      expect(evmEntry).toBeDefined();
      expect(svmEntry).toBeDefined();
      expect(evmEntry?.namespace).toBe("evm");
      expect(svmEntry?.namespace).toBe("svm");
    });
  });
});
