import type { AcceptOption, ProtocolQuote, ProtocolResult } from "@boltzpay/core";
import { Money } from "@boltzpay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @coinbase/cdp-sdk to prevent real imports
vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {
    constructor() {}
  },
}));

// Mock @boltzpay/protocols with controllable adapter behavior
const mockProbeAll = vi.fn();
const mockProbe = vi.fn();
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
    probe = mockProbe;
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
  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: MockX402Adapter,
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
    AggregatePaymentError: MockAdapterError,
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
    payTo: "0xEvmAddr",
    asset: "USDC",
    scheme: "exact",
  };
}

function makeSvmAccept(amountCents: bigint): AcceptOption {
  return {
    namespace: "svm",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    amount: amountCents,
    payTo: "SolanaAddr123",
    asset: "USDC",
    scheme: "exact",
  };
}

function makeQuoteWithAccepts(accepts: AcceptOption[]): ProtocolQuote {
  const primary = accepts[0]!;
  return {
    amount: Money.fromCents(primary.amount),
    protocol: "x402",
    network: primary.network,
    payTo: primary.payTo,
    allAccepts: accepts,
  };
}

function makeSuccessResult(overrides?: Partial<ProtocolResult>): ProtocolResult {
  return {
    success: true,
    externalTxHash: "0xtx_integration",
    responseBody: new TextEncoder().encode('{"data":"ok"}'),
    responseHeaders: { "content-type": "application/json" },
    responseStatus: 200,
    ...overrides,
  };
}

describe("multi-chain integration (SDK end-to-end)", () => {
  beforeEach(() => {
    mockProbeAll.mockReset();
    mockProbe.mockReset();
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

  describe("Scenario 1: Multi-accept chain selection (cheapest wins)", () => {
    it("selects SVM when it is cheaper than EVM and no preference is set", async () => {
      const evmAccept = makeEvmAccept(500n); // $0.05 EVM
      const svmAccept = makeSvmAccept(300n); // $0.03 SVM (cheaper)
      const quote = makeQuoteWithAccepts([evmAccept, svmAccept]);
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(validConfig);
      const paymentListener = vi.fn();
      client.on("payment", paymentListener);

      const response = await client.fetch("https://multi.api/endpoint");

      expect(response.ok).toBe(true);
      // Verify execute was called with SVM amount (cheaper)
      const executeCall = mockExecute.mock.calls[0]!;
      expect(executeCall[1].amount.cents).toBe(300n);
      // Verify PaymentRecord has Solana network
      expect(paymentListener).toHaveBeenCalledTimes(1);
      const record = paymentListener.mock.calls[0]![0];
      expect(record.network).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    });
  });

  describe("Scenario 2: preferredChains override", () => {
    it("selects EVM when preferredChains: ['evm'] despite SVM being cheaper", async () => {
      const evmAccept = makeEvmAccept(500n); // $0.05 EVM
      const svmAccept = makeSvmAccept(300n); // $0.03 SVM (cheaper)
      const quote = makeQuoteWithAccepts([evmAccept, svmAccept]);
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay({
        ...validConfig,
        preferredChains: ["evm"],
      });
      const paymentListener = vi.fn();
      client.on("payment", paymentListener);

      const response = await client.fetch("https://multi.api/preferred");

      expect(response.ok).toBe(true);
      // Verify execute was called with EVM amount (preferred)
      const executeCall = mockExecute.mock.calls[0]!;
      expect(executeCall[1].amount.cents).toBe(500n);
      // Verify PaymentRecord has EVM network
      const record = paymentListener.mock.calls[0]![0];
      expect(record.network).toBe("eip155:8453");
    });
  });

  describe("Scenario 3: chain option override", () => {
    it("fetch(url, { chain: 'svm' }) pays via SVM regardless of config preference", async () => {
      const evmAccept = makeEvmAccept(300n); // EVM is cheaper
      const svmAccept = makeSvmAccept(500n);
      const quote = makeQuoteWithAccepts([evmAccept, svmAccept]);
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      // Config prefers EVM, but per-request chain override to SVM
      const client = new BoltzPay({
        ...validConfig,
        preferredChains: ["evm"],
      });
      const paymentListener = vi.fn();
      client.on("payment", paymentListener);

      const response = await client.fetch("https://multi.api/override", {
        chain: "svm",
      });

      expect(response.ok).toBe(true);
      // Verify SVM was used via chain override
      const executeCall = mockExecute.mock.calls[0]!;
      expect(executeCall[1].amount.cents).toBe(500n);
      const record = paymentListener.mock.calls[0]![0];
      expect(record.network).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    });
  });

  describe("Scenario 4: Router fallback (x402 fails, other adapter succeeds)", () => {
    it("falls back to other adapter when x402 execution fails", async () => {
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
      // x402 execution fails
      mockExecute.mockRejectedValueOnce(new Error("x402 payment failed"));
      // Other adapter execution succeeds
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: "tx_other_fallback" }),
      );

      const client = new BoltzPay(validConfig);
      const response = await client.fetch("https://multi.api/fallback");

      expect(response.ok).toBe(true);
      expect(response.protocol).toBe("other");
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });
  });

  describe("Scenario 5: No compatible chain", () => {
    it("throws ProtocolError('no_compatible_chain') for unsupported namespace", async () => {
      // Mock accept with namespace that parseNetworkIdentifier rejects
      const unknownAccept: AcceptOption = {
        namespace: "btc" as "evm", // Force incompatible namespace
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
        await client.fetch("https://btc-only.api/pay");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ProtocolError);
        expect((err as ProtocolError).code).toBe("no_compatible_chain");
      }
    });
  });

  describe("Scenario 6: getCapabilities + getBalances", () => {
    it("getCapabilities() returns chains, protocols, and addresses", () => {
      mockGetAddresses.mockReturnValue({
        evm: "0xMyEvmAddress",
        svm: "MySolanaAddress",
      });

      const client = new BoltzPay(validConfig);
      const caps = client.getCapabilities();

      expect(caps.chains).toEqual(["evm", "svm"]);
      expect(caps.protocols).toContain("x402");
      expect(caps.addresses.evm).toBe("0xMyEvmAddress");
      expect(caps.addresses.svm).toBe("MySolanaAddress");
      expect(caps.network).toBe("base");
    });

    it("getBalances() returns per-chain balance info", async () => {
      mockGetBalances.mockResolvedValue({
        evm: { address: "0xMyEvmAddress", balanceUsdcCents: 1000n },
        svm: { address: "MySolanaAddress", balanceUsdcCents: 500n },
      });

      const client = new BoltzPay(validConfig);
      const balances = await client.getBalances();

      expect(balances.evm).toBeDefined();
      expect(balances.evm!.address).toBe("0xMyEvmAddress");
      expect(balances.evm!.balance!.cents).toBe(1000n);
      expect(balances.svm).toBeDefined();
      expect(balances.svm!.address).toBe("MySolanaAddress");
      expect(balances.svm!.balance!.cents).toBe(500n);
    });

    it("getBalances() degrades gracefully on failure", async () => {
      mockGetBalances.mockRejectedValue(new Error("CDP unavailable"));

      const client = new BoltzPay(validConfig);
      const balances = await client.getBalances();

      expect(balances).toEqual({});
    });
  });

  describe("full flow: multi-chain fetch with payment record verification", () => {
    it("payment history records network from chain selection", async () => {
      const evmAccept = makeEvmAccept(200n);
      const svmAccept = makeSvmAccept(100n); // Cheaper
      const quote = makeQuoteWithAccepts([evmAccept, svmAccept]);
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(validConfig);
      await client.fetch("https://multi.api/history");

      const history = client.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]!.protocol).toBe("x402");
      expect(history[0]!.network).toBe(
        "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      );
      expect(history[0]!.amount.cents).toBe(100n);
    });

    it("budget tracks spending from selected chain amount", async () => {
      const evmAccept = makeEvmAccept(200n);
      const svmAccept = makeSvmAccept(100n); // Cheaper
      const quote = makeQuoteWithAccepts([evmAccept, svmAccept]);
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(validConfig);
      await client.fetch("https://multi.api/budget");

      const budget = client.getBudget();
      expect(budget.dailySpent.cents).toBe(100n); // SVM amount, not EVM
      expect(budget.monthlySpent.cents).toBe(100n);
    });

    it("V1 endpoint without allAccepts uses primary quote directly", async () => {
      const v1Quote: ProtocolQuote = {
        amount: Money.fromCents(50n),
        protocol: "x402",
        network: "base-sepolia",
        payTo: "0xLegacyPay",
        // No allAccepts — V1 endpoint
      };
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: mockAdapter, quote: v1Quote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(validConfig);
      const response = await client.fetch("https://v1.api/legacy");

      expect(response.ok).toBe(true);
      const executeCall = mockExecute.mock.calls[0]!;
      expect(executeCall[1].amount.cents).toBe(50n);
    });

    it("EVM wins tie-break when prices are equal", async () => {
      const evmAccept = makeEvmAccept(100n);
      const svmAccept = makeSvmAccept(100n); // Same price
      const quote = makeQuoteWithAccepts([evmAccept, svmAccept]);
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(validConfig);
      const paymentListener = vi.fn();
      client.on("payment", paymentListener);

      await client.fetch("https://multi.api/tiebreak");

      const record = paymentListener.mock.calls[0]![0];
      // EVM should win tie-break at same price
      expect(record.network).toBe("eip155:8453");
    });
  });
});
