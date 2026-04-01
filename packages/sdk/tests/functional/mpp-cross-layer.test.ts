import type { ProtocolQuote, ProtocolResult } from "@boltzpay/core";
import { Money } from "@boltzpay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockProbe,
  mockProbeAll,
  mockExecute,
  mockGetAddresses,
  mockGetBalances,
} = vi.hoisted(() => ({
  mockProbe: vi.fn(),
  mockProbeAll: vi.fn(),
  mockExecute: vi.fn(),
  mockGetAddresses: vi.fn(),
  mockGetBalances: vi.fn(),
}));

vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {},
}));

vi.mock("@boltzpay/protocols", () => {
  class MockCdpWalletManager {
    getAddresses = mockGetAddresses;
    getBalances = mockGetBalances;
  }
  class MockProtocolRouter {
    probe = mockProbe;
    probeAll = mockProbeAll;
    execute = mockExecute;
    probeFromResponse = vi.fn();
  }
  class MockX402Adapter {
    name = "x402";
  }
  class MockL402Adapter {
    name = "l402";
  }
  class MockMppAdapter {
    name = "mpp";
  }
  class MockMppMethodSelector {}
  class MockNwcWalletManager {
    close() {}
  }
  class MockAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "AdapterError";
    }
  }
  class MockX402PaymentError extends MockAdapterError {
    constructor(message: string) {
      super("x402_payment_failed", message);
    }
  }
  class MockAggregatePaymentError extends MockAdapterError {
    errors: readonly Error[];
    constructor(errors: readonly Error[]) {
      super("aggregate_payment_failed", errors.map((e) => e.message).join("; "));
      this.errors = errors;
    }
  }
  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: MockX402Adapter,
    L402Adapter: MockL402Adapter,
    MppAdapter: MockMppAdapter,
    MppMethodSelector: MockMppMethodSelector,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
    X402PaymentError: MockX402PaymentError,
    AggregatePaymentError: MockAggregatePaymentError,
  };
});

import { BoltzPay } from "../../src/boltzpay";
import { NoWalletError } from "../../src/errors/no-wallet-error";

function makeMppQuote(overrides?: Partial<ProtocolQuote>): ProtocolQuote {
  return {
    amount: Money.fromCents(50n),
    protocol: "mpp",
    payTo: "0x1234abcd",
    scheme: "exact",
    selectedMethod: "tempo",
    ...overrides,
  };
}

function makeX402Quote(): ProtocolQuote {
  return {
    amount: Money.fromCents(100n),
    protocol: "x402",
    network: "eip155:8453",
    payTo: "0xabc",
    scheme: "exact",
  };
}

function makeSuccessResult(): ProtocolResult {
  return {
    success: true,
    externalTxHash: "0xmpp_tx_abc",
    responseBody: new TextEncoder().encode('{"data":"paid"}'),
    responseHeaders: { "content-type": "application/json" },
    responseStatus: 200,
  };
}

const tempoConfig = {
  wallets: [
    {
      type: "tempo" as const,
      name: "my-tempo-wallet",
      tempoPrivateKey: "test-pk",
    },
  ],
};

const coinbaseConfig = {
  coinbaseApiKeyId: "key",
  coinbaseApiKeySecret: "secret",
  coinbaseWalletSecret: "wallet",
};

describe("MPP cross-layer integration", () => {
  beforeEach(() => {
    mockProbe.mockReset();
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

  describe("SDK fetch → MPP payment end-to-end", () => {
    it("completes payment, emits wallet:selected and payment:success", async () => {
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "mpp" }, quote: makeMppQuote() },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const walletListener = vi.fn();
      const paymentListener = vi.fn();
      const sdk = new BoltzPay(tempoConfig);
      sdk.on("wallet:selected", walletListener);
      sdk.on("payment", paymentListener);

      const response = await sdk.fetch("https://mpp-api.example.com/data");

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ data: "paid" });

      expect(walletListener).toHaveBeenCalledTimes(1);
      expect(walletListener.mock.calls[0]![0].walletName).toBe("my-tempo-wallet");
      expect(walletListener.mock.calls[0]![0].network).toBe("tempo");

      expect(paymentListener).toHaveBeenCalledTimes(1);
      expect(paymentListener.mock.calls[0]![0].protocol).toBe("mpp");

      sdk.close();
    });

    it("records MPP payment in history", async () => {
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "mpp" }, quote: makeMppQuote() },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const sdk = new BoltzPay(tempoConfig);
      await sdk.fetch("https://mpp-api.example.com/data");

      const history = sdk.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]!.protocol).toBe("mpp");
      expect(history[0]!.url).toContain("mpp-api.example.com");

      sdk.close();
    });

    it("tracks budget spend after MPP payment", async () => {
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "mpp" }, quote: makeMppQuote() },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const sdk = new BoltzPay({
        ...tempoConfig,
        budget: { daily: "10.00" },
      });
      await sdk.fetch("https://mpp-api.example.com/data");

      const budget = sdk.getBudget();
      expect(budget.dailySpent).not.toBe("$0.00");

      sdk.close();
    });
  });

  describe("SDK quote → MPP pricing", () => {
    it("returns MPP protocol and price", async () => {
      mockProbe.mockResolvedValueOnce({
        adapter: { name: "mpp" },
        quote: makeMppQuote(),
      });

      const sdk = new BoltzPay(tempoConfig);
      const quote = await sdk.quote("https://mpp-api.example.com/data");

      expect(quote.protocol).toBe("mpp");
      expect(quote.amount.toDisplayString()).toBe("$0.50");

      sdk.close();
    });
  });

  describe("wallet-aware protocol fallback", () => {
    it("tempo wallet → MPP adapter executed (not x402)", async () => {
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "mpp" }, quote: makeMppQuote() },
        { adapter: { name: "x402" }, quote: makeX402Quote() },
      ]);
      mockExecute.mockImplementation(async () => makeSuccessResult());

      const sdk = new BoltzPay(tempoConfig);
      await sdk.fetch("https://dual.example.com/api");

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute.mock.calls[0]![0].name).toBe("mpp");

      sdk.close();
    });

    it("coinbase wallet → x402 adapter executed (MPP skipped)", async () => {
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "mpp" }, quote: makeMppQuote() },
        { adapter: { name: "x402" }, quote: makeX402Quote() },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const sdk = new BoltzPay(coinbaseConfig);
      await sdk.fetch("https://dual.example.com/api");

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute.mock.calls[0]![0].name).toBe("x402");

      sdk.close();
    });

    it("no wallet → NoWalletError", async () => {
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "mpp" }, quote: makeMppQuote() },
      ]);

      const sdk = new BoltzPay({ wallets: [] });

      await expect(
        sdk.fetch("https://mpp-only.com/api"),
      ).rejects.toThrow(NoWalletError);

      sdk.close();
    });
  });

  describe("budget enforcement", () => {
    it("blocks MPP payment when over daily budget", async () => {
      mockProbeAll.mockResolvedValueOnce([
        {
          adapter: { name: "mpp" },
          quote: makeMppQuote({ amount: Money.fromDollars("500.00") }),
        },
      ]);

      const sdk = new BoltzPay({
        ...tempoConfig,
        budget: { daily: "1.00" },
      });

      await expect(
        sdk.fetch("https://expensive.com/api"),
      ).rejects.toThrow(/budget/i);

      sdk.close();
    });
  });
});
