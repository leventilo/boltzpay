import type { ProtocolQuote, ProtocolResult } from "@boltzpay/core";
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
    close() {}
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
    MppAdapter: class MockMppAdapter { name = "mpp"; constructor() {} },
    MppMethodSelector: class MockMppMethodSelector { constructor() {} },
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
    X402PaymentError: MockX402PaymentError,
    AggregatePaymentError: MockAggregatePaymentError,
  };
});

// Import AFTER mocks
import { BoltzPay } from "../../src/boltzpay";
import { NoWalletError } from "../../src/errors/no-wallet-error";
import { UnsupportedNetworkError } from "../../src/errors/unsupported-network-error";

const validConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

function makeQuote(overrides?: Partial<ProtocolQuote>): ProtocolQuote {
  return {
    amount: Money.fromCents(100n),
    protocol: "x402",
    network: "eip155:8453",
    payTo: "0xabc",
    scheme: "exact",
    ...overrides,
  };
}

function makeSuccessResult(): ProtocolResult {
  return {
    success: true,
    externalTxHash: "0xtx_wallet_routing",
    responseBody: new TextEncoder().encode("{}"),
    responseHeaders: { "content-type": "application/json" },
    responseStatus: 200,
  };
}

describe("wallet routing", () => {
  beforeEach(() => {
    mockProbeAll.mockReset();
    mockExecute.mockReset();
    mockGetAddresses.mockReset();
    mockGetBalances.mockReset();
    mockGetAddresses.mockReturnValue({});
    mockGetBalances.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("selectWalletForPayment", () => {
    it("single coinbase wallet (backward compat) — payment works on evm network", async () => {
      const quote = makeQuote({ network: "eip155:8453" });
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(validConfig);
      const response = await client.fetch("https://paid.com/api");

      expect(response.ok).toBe(true);
    });

    it("wallet:selected event emitted with correct payload", async () => {
      const quote = makeQuote({ network: "eip155:8453" });
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const walletSelectedListener = vi.fn();
      const client = new BoltzPay(validConfig);
      client.on("wallet:selected", walletSelectedListener);

      await client.fetch("https://paid.com/api");

      expect(walletSelectedListener).toHaveBeenCalledTimes(1);
      const event = walletSelectedListener.mock.calls[0][0];
      expect(event).toEqual(
        expect.objectContaining({
          walletName: "default",
          network: "evm",
          reason: expect.any(String),
        }),
      );
    });

    it("NoWalletError when no wallet matches stellar namespace", async () => {
      const quote = makeQuote({ network: "stellar:pubnet" });
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);

      const client = new BoltzPay(validConfig);

      await expect(
        client.fetch("https://paid.com/stellar-api"),
      ).rejects.toThrow(UnsupportedNetworkError);
    });

    it("protocol:unsupported-network event emitted for stellar", async () => {
      const quote = makeQuote({ network: "stellar:pubnet" });
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);

      const unsupportedListener = vi.fn();
      const client = new BoltzPay(validConfig);
      client.on("protocol:unsupported-network", unsupportedListener);

      try {
        await client.fetch("https://paid.com/stellar-api");
      } catch {
        // Expected to throw
      }

      expect(unsupportedListener).toHaveBeenCalledTimes(1);
      const event = unsupportedListener.mock.calls[0][0];
      expect(event.namespace).toBe("stellar");
    });

    it("NoWalletError when no coinbase wallet exists for x402 payment", async () => {
      const quote = makeQuote({ network: "eip155:8453" });
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);

      // SDK with no wallets (empty)
      const client = new BoltzPay({ wallets: [] });

      await expect(
        client.fetch("https://paid.com/api"),
      ).rejects.toThrow(NoWalletError);
    });

    it("multiple wallets with overlapping networks — first in array wins", async () => {
      const quote = makeQuote({ network: "eip155:8453" });
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const walletSelectedListener = vi.fn();
      const client = new BoltzPay({
        wallets: [
          {
            type: "coinbase",
            name: "first-evm",
            coinbaseApiKeyId: "k1",
            coinbaseApiKeySecret: "s1",
            coinbaseWalletSecret: "w1",
            networks: ["evm"],
          },
          {
            type: "coinbase",
            name: "second-evm",
            coinbaseApiKeyId: "k2",
            coinbaseApiKeySecret: "s2",
            coinbaseWalletSecret: "w2",
            networks: ["evm"],
          },
        ],
      });
      client.on("wallet:selected", walletSelectedListener);

      await client.fetch("https://paid.com/api");

      expect(walletSelectedListener).toHaveBeenCalledTimes(1);
      const event = walletSelectedListener.mock.calls[0][0];
      expect(event.walletName).toBe("first-evm");
      expect(event.reason).toBe("first_match");
    });

    it("wildcard wallet (networks: undefined) matches any namespace", async () => {
      const quote = makeQuote({
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      });
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([{ adapter: mockAdapter, quote }]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const walletSelectedListener = vi.fn();
      // flat creds = wildcard wallet (networks: undefined)
      const client = new BoltzPay(validConfig);
      client.on("wallet:selected", walletSelectedListener);

      await client.fetch("https://paid.com/solana-api");

      expect(walletSelectedListener).toHaveBeenCalledTimes(1);
      const event = walletSelectedListener.mock.calls[0][0];
      expect(event.walletName).toBe("default");
      expect(event.network).toBe("svm");
    });
  });
});
