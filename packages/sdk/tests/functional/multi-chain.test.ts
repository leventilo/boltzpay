import type { AcceptOption, ProtocolQuote, ProtocolResult } from "@boltzpay/core";
import { Money } from "@boltzpay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @coinbase/cdp-sdk to prevent real imports
vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {
    constructor() {}
  },
}));

// Mock @boltzpay/protocols to provide controllable adapter behavior
const mockProbeAll = vi.fn();
const mockExecute = vi.fn();
const mockGetAdapterByName = vi.fn();
const mockGetAddresses = vi.fn();
const mockGetBalances = vi.fn();

vi.mock("@boltzpay/protocols", () => {
  class MockCdpWalletManager {
    constructor() {}
    getAddresses = mockGetAddresses;
    getBalances = mockGetBalances;
  }
  class MockProtocolRouter {
    probeAll = mockProbeAll;
    execute = mockExecute;
    getAdapterByName = mockGetAdapterByName;
    constructor() {}
  }
  class MockX402Adapter {
    name = "x402";
    constructor() {}
  }
  class MockAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "AdapterError";
    }
  }
  class MockL402Adapter {
    name = "l402";
    constructor() {}
  }
  class MockNwcWalletManager {
    constructor() {}
  }
  class MockX402PaymentError extends MockAdapterError {
    deliveryAttempts?: readonly { method: string; headerName: string; status: number }[];
    suggestion?: string;
    constructor(
      message: string,
      opts?: {
        deliveryAttempts?: readonly { method: string; headerName: string; status: number }[];
        suggestion?: string;
      },
    ) {
      super("x402_payment_failed", message);
      this.deliveryAttempts = opts?.deliveryAttempts;
      this.suggestion = opts?.suggestion;
    }
  }
  class MockAggregatePaymentError extends MockAdapterError {
    errors: readonly Error[];
    constructor(errors: readonly Error[]) {
      const messages = errors.map((e, i) => `  ${i + 1}. ${e.message}`).join("\n");
      super("aggregate_payment_failed", `All payment attempts failed:\n${messages}`);
      this.errors = errors;
    }
  }
  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: MockX402Adapter,
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
    X402PaymentError: MockX402PaymentError,
    AggregatePaymentError: MockAggregatePaymentError,
  };
});

// Import AFTER mocks
import { BoltzPay } from "../../src/boltzpay";
import { ProtocolError } from "../../src/errors/protocol-error";

const validConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

function makeEvmAccept(amountCents: bigint): AcceptOption {
  return {
    namespace: "evm",
    network: "eip155:8453",
    amount: amountCents,
    payTo: "0xabc",
    asset: "USDC",
    scheme: "exact",
  };
}

function makeSvmAccept(amountCents: bigint): AcceptOption {
  return {
    namespace: "svm",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    amount: amountCents,
    payTo: "5xyzSolana",
    asset: "USDC",
    scheme: "exact",
  };
}

function makeQuoteWithAccepts(
  accepts: AcceptOption[],
): ProtocolQuote {
  const primary = accepts[0]!;
  return {
    amount: Money.fromCents(primary.amount),
    protocol: "x402",
    network: primary.network,
    payTo: primary.payTo,
    allAccepts: accepts,
  };
}

function makeSuccessResult(): ProtocolResult {
  return {
    success: true,
    externalTxHash: "0xtx_multichain",
    responseBody: new TextEncoder().encode("{}"),
    responseHeaders: { "content-type": "application/json" },
    responseStatus: 200,
  };
}

describe("multi-chain SDK composition", () => {
  beforeEach(() => {
    mockProbeAll.mockReset();
    mockExecute.mockReset();
    mockGetAdapterByName.mockReset();
    mockGetAddresses.mockReset();
    mockGetBalances.mockReset();
    // Default stubs
    mockGetAddresses.mockReturnValue({});
    mockGetBalances.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getCapabilities()", () => {
    it("returns chains: ['evm', 'svm']", () => {
      const client = new BoltzPay(validConfig);
      const caps = client.getCapabilities();
      expect(caps.chains).toEqual(["evm", "svm"]);
    });

    it("returns protocols with only 'x402' when no NWC connection", () => {
      const client = new BoltzPay(validConfig);
      const caps = client.getCapabilities();
      expect(caps.protocols).toEqual(["x402"]);
    });

    it("returns addresses from walletManager", () => {
      mockGetAddresses.mockReturnValue({
        evm: "0xABC123",
        svm: "5xyzSolana",
      });
      const client = new BoltzPay(validConfig);
      const caps = client.getCapabilities();
      expect(caps.addresses).toEqual({
        evm: "0xABC123",
        svm: "5xyzSolana",
      });
    });

    it("returns empty addresses when walletManager has no cached accounts", () => {
      mockGetAddresses.mockReturnValue({});
      const client = new BoltzPay(validConfig);
      const caps = client.getCapabilities();
      expect(caps.addresses).toEqual({});
    });
  });

  describe("getBalances()", () => {
    it("returns balance data from walletManager", async () => {
      mockGetBalances.mockResolvedValue({
        evm: { address: "0xABC", balanceUsdcCents: 500n },
      });
      const client = new BoltzPay(validConfig);
      const balances = await client.getBalances();
      expect(balances.evm).toBeDefined();
      expect(balances.evm!.address).toBe("0xABC");
      expect(balances.evm!.balance!.cents).toBe(500n);
    });

    it("returns empty when walletManager has no provisioned accounts", async () => {
      mockGetBalances.mockResolvedValue({});
      const client = new BoltzPay(validConfig);
      const balances = await client.getBalances();
      expect(balances.evm).toBeUndefined();
      expect(balances.svm).toBeUndefined();
    });

    it("handles walletManager.getBalances() failure gracefully", async () => {
      mockGetBalances.mockRejectedValue(new Error("CDP unavailable"));
      const client = new BoltzPay(validConfig);
      const balances = await client.getBalances();
      expect(balances).toEqual({});
    });

    it("returns balance as undefined when balanceUsdcCents is undefined", async () => {
      mockGetBalances.mockResolvedValue({
        evm: { address: "0xABC", balanceUsdcCents: undefined },
      });
      const client = new BoltzPay(validConfig);
      const balances = await client.getBalances();
      expect(balances.evm).toBeDefined();
      expect(balances.evm!.address).toBe("0xABC");
      expect(balances.evm!.balance).toBeUndefined();
    });
  });

  describe("fetch() with chain selection", () => {
    it("selects cheapest when allAccepts has EVM+SVM and no preference", async () => {
      const evmAccept = makeEvmAccept(100n);
      const svmAccept = makeSvmAccept(80n); // SVM is cheaper
      const quote = makeQuoteWithAccepts([evmAccept, svmAccept]);
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(validConfig);
      const response = await client.fetch("https://paid.com/multi");

      expect(response.ok).toBe(true);
      // The execute call should use the SVM quote (80 cents, cheaper)
      const executeCall = mockExecute.mock.calls[0];
      expect(executeCall[1].amount.cents).toBe(80n);
    });

    it("selects SVM when preferredChains: ['svm'] even if EVM is cheaper", async () => {
      const evmAccept = makeEvmAccept(50n); // EVM cheaper
      const svmAccept = makeSvmAccept(100n);
      const quote = makeQuoteWithAccepts([evmAccept, svmAccept]);
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay({
        ...validConfig,
        preferredChains: ["svm"],
      });
      const response = await client.fetch("https://paid.com/multi");

      expect(response.ok).toBe(true);
      const executeCall = mockExecute.mock.calls[0];
      expect(executeCall[1].amount.cents).toBe(100n);
    });

    it("options.chain overrides config preferredChains", async () => {
      const evmAccept = makeEvmAccept(50n);
      const svmAccept = makeSvmAccept(100n);
      const quote = makeQuoteWithAccepts([evmAccept, svmAccept]);
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      // Config prefers EVM, but options.chain overrides to SVM
      const client = new BoltzPay({
        ...validConfig,
        preferredChains: ["evm"],
      });
      const response = await client.fetch("https://paid.com/multi", {
        chain: "svm",
      });

      expect(response.ok).toBe(true);
      const executeCall = mockExecute.mock.calls[0];
      expect(executeCall[1].amount.cents).toBe(100n);
    });

    it("throws ProtocolError('no_compatible_chain') when no compatible chain", async () => {
      // Only SVM accept, but we'll set up a scenario where selectBestAccept fails
      // Since we mock the core function, let's test with an accept that has unknown namespace
      const unknownAccept: AcceptOption = {
        namespace: "btc" as "evm", // Force incompatible type
        network: "btc:mainnet",
        amount: 100n,
        payTo: "bc1q...",
        asset: "BTC",
        scheme: "exact",
      };
      const quote: ProtocolQuote = {
        amount: Money.fromCents(100n),
        protocol: "x402",
        network: "btc:mainnet",
        payTo: "bc1q...",
        allAccepts: [unknownAccept],
      };
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);

      const client = new BoltzPay(validConfig);

      try {
        await client.fetch("https://paid.com/btc-only");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ProtocolError);
        expect((err as ProtocolError).code).toBe("no_compatible_chain");
      }
    });

    it("uses primary quote directly when allAccepts is undefined", async () => {
      // V1 endpoint without allAccepts
      const quote: ProtocolQuote = {
        amount: Money.fromCents(100n),
        protocol: "x402",
        network: "base-sepolia",
        payTo: "0xabc",
      };
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(validConfig);
      const response = await client.fetch("https://paid.com/v1");

      expect(response.ok).toBe(true);
      const executeCall = mockExecute.mock.calls[0];
      expect(executeCall[1].amount.cents).toBe(100n);
    });
  });

  describe("fetch() with router fallback", () => {
    it("returns result when first adapter succeeds (no fallback needed)", async () => {
      const quote: ProtocolQuote = {
        amount: Money.fromCents(100n),
        protocol: "x402",
        network: "eip155:8453",
        payTo: "0xabc",
      };
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(validConfig);
      const response = await client.fetch("https://paid.com/api");

      expect(response.ok).toBe(true);
      expect(response.protocol).toBe("x402");
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it("falls back to second adapter when first fails", async () => {
      const x402Quote: ProtocolQuote = {
        amount: Money.fromCents(100n),
        protocol: "x402",
        network: "eip155:8453",
        payTo: "0xabc",
      };
      const otherQuote: ProtocolQuote = {
        amount: Money.fromCents(100n),
        protocol: "other",
        network: undefined,
        payTo: undefined,
      };
      const x402Adapter = { name: "x402" };
      const otherAdapter = { name: "other" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: x402Adapter, quote: x402Quote },
        { adapter: otherAdapter, quote: otherQuote },
      ]);
      // First execute fails (x402 payment failure)
      mockExecute.mockRejectedValueOnce(new Error("x402 payment failed"));
      // Second execute succeeds (other adapter fallback)
      mockExecute.mockResolvedValueOnce({
        success: true,
        externalTxHash: "tx_fallback",
        responseBody: new TextEncoder().encode("{}"),
        responseHeaders: { "content-type": "application/json" },
        responseStatus: 200,
      });

      const client = new BoltzPay(validConfig);
      const response = await client.fetch("https://paid.com/api");

      expect(response.ok).toBe(true);
      expect(response.protocol).toBe("other");
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it("throws when all adapters fail (aggregate error)", async () => {
      const quote: ProtocolQuote = {
        amount: Money.fromCents(100n),
        protocol: "x402",
        network: "eip155:8453",
        payTo: "0xabc",
      };
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockRejectedValueOnce(new Error("x402 payment failed"));

      const errorListener = vi.fn();
      const client = new BoltzPay(validConfig);
      client.on("error", errorListener);

      await expect(
        client.fetch("https://paid.com/api"),
      ).rejects.toThrow(ProtocolError);

      // 2 error events: one from the failed adapter (wrapProtocolError), one from the aggregate
      expect(errorListener).toHaveBeenCalledTimes(2);
      // Last error should be the aggregate ProtocolError
      const lastErr = errorListener.mock.calls[1][0];
      expect(lastErr).toBeInstanceOf(ProtocolError);
      expect(lastErr.code).toBe("payment_failed");
    });

    it("only one adapter detected, throws on failure (no fallback)", async () => {
      const quote: ProtocolQuote = {
        amount: Money.fromCents(100n),
        protocol: "x402",
        network: "eip155:8453",
        payTo: "0xabc",
      };
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockRejectedValueOnce(new Error("Payment failed"));

      const client = new BoltzPay(validConfig);

      await expect(
        client.fetch("https://paid.com/api"),
      ).rejects.toThrow(ProtocolError);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe("PaymentRecord includes network from selected accept", () => {
    it("payment event has network from chain selection", async () => {
      const evmAccept = makeEvmAccept(100n);
      const svmAccept = makeSvmAccept(100n);
      const quote = makeQuoteWithAccepts([evmAccept, svmAccept]);
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const paymentListener = vi.fn();
      const client = new BoltzPay(validConfig);
      client.on("payment", paymentListener);

      await client.fetch("https://paid.com/multi");

      expect(paymentListener).toHaveBeenCalledTimes(1);
      const record = paymentListener.mock.calls[0][0];
      // EVM should be selected (tie-break: evm preferred over svm at same price)
      expect(record.network).toBe("eip155:8453");
    });
  });
});
