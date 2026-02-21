import type { ProtocolQuote, ProtocolResult } from "@boltzpay/core";
import { Money, ProtocolDetectionFailedError } from "@boltzpay/core";
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

vi.mock("@boltzpay/protocols", () => {
  class MockCdpWalletManager {
    constructor() {}
    getAddresses() {
      return {};
    }
    async getBalances() {
      return {};
    }
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
  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: MockX402Adapter,
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
  };
});

// Import AFTER mocks
import { BoltzPay } from "../../src/boltzpay";
import { BudgetExceededError } from "../../src/errors/budget-exceeded-error";

const baseConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

function makeProbeResult(amountCents: bigint): {
  adapter: { name: string };
  quote: ProtocolQuote;
} {
  return {
    adapter: { name: "x402" },
    quote: {
      amount: Money.fromCents(amountCents),
      protocol: "x402",
      network: "eip155:84532",
      payTo: "0xabc",
    },
  };
}

function makeSuccessResult(): ProtocolResult {
  return {
    success: true,
    externalTxHash: "0xtx_budget_test",
    responseBody: new TextEncoder().encode("{}"),
    responseHeaders: { "content-type": "application/json" },
    responseStatus: 200,
  };
}

describe("budget blocking", () => {
  afterEach(() => {
    mockProbeAll.mockReset();
    mockExecute.mockReset();
    mockGetAdapterByName.mockReset();
    vi.clearAllMocks();
  });

  describe("per-transaction limit", () => {
    it("should block payment when quote exceeds perTransaction limit", async () => {
      const agent = new BoltzPay({
        ...baseConfig,
        budget: { perTransaction: 0.5, daily: 5, monthly: 100 },
      });

      // Quote returns $1.00 (100 cents), per-tx limit is $0.50
      mockProbeAll.mockResolvedValueOnce([makeProbeResult(100n)]);

      await expect(agent.fetch("https://paid.com/expensive")).rejects.toThrow(
        BudgetExceededError,
      );
    });

    it("should emit budget:exceeded event with period per_transaction", async () => {
      const agent = new BoltzPay({
        ...baseConfig,
        budget: { perTransaction: 0.5, daily: 5, monthly: 100 },
      });

      // Quote returns $1.00
      mockProbeAll.mockResolvedValueOnce([makeProbeResult(100n)]);

      const exceededListener = vi.fn();
      agent.on("budget:exceeded", exceededListener);

      await expect(agent.fetch("https://paid.com/expensive")).rejects.toThrow(
        BudgetExceededError,
      );

      expect(exceededListener).toHaveBeenCalledTimes(1);
      expect(exceededListener.mock.calls[0][0].period).toBe("per_transaction");
    });

    it("should allow payment when quote is below perTransaction limit", async () => {
      const agent = new BoltzPay({
        ...baseConfig,
        budget: { perTransaction: 0.5, daily: 5, monthly: 100 },
      });

      // Quote returns $0.30 (30 cents), within per-tx limit
      mockProbeAll.mockResolvedValueOnce([makeProbeResult(30n)]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const response = await agent.fetch("https://paid.com/cheap");
      expect(response.ok).toBe(true);
    });
  });

  describe("daily limit cumulative", () => {
    it("should block payment when cumulative spending exceeds daily limit", async () => {
      const agent = new BoltzPay({
        ...baseConfig,
        budget: { perTransaction: 0.5, daily: 1.5 },
      });

      const exceededListener = vi.fn();
      const errorListener = vi.fn();
      agent.on("budget:exceeded", exceededListener);
      agent.on("error", errorListener);

      // Execute 5 successful calls of $0.30 each (total $1.50)
      for (let i = 0; i < 5; i++) {
        mockProbeAll.mockResolvedValueOnce([makeProbeResult(30n)]);
        mockExecute.mockResolvedValueOnce(makeSuccessResult());
      }

      // First 5 calls succeed (total $1.50 = daily limit)
      for (let i = 0; i < 5; i++) {
        await agent.fetch("https://paid.com/api");
      }

      // 6th call should fail -- daily budget exceeded
      mockProbeAll.mockResolvedValueOnce([makeProbeResult(30n)]);

      await expect(agent.fetch("https://paid.com/api")).rejects.toThrow(
        BudgetExceededError,
      );

      expect(exceededListener).toHaveBeenCalledTimes(1);
      expect(exceededListener.mock.calls[0][0].period).toBe("daily");
    });

    it("should not include blocked transaction in history", async () => {
      const agent = new BoltzPay({
        ...baseConfig,
        budget: { perTransaction: 1.0, daily: 0.5 },
      });

      // First call: $0.30 succeeds
      mockProbeAll.mockResolvedValueOnce([makeProbeResult(30n)]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());
      await agent.fetch("https://paid.com/api");

      expect(agent.getHistory()).toHaveLength(1);

      // Second call: $0.30 exceeds daily ($0.60 > $0.50)
      mockProbeAll.mockResolvedValueOnce([makeProbeResult(30n)]);

      await expect(agent.fetch("https://paid.com/api")).rejects.toThrow(
        BudgetExceededError,
      );

      // History should still only have 1 record
      expect(agent.getHistory()).toHaveLength(1);
    });

    it("should emit error event when budget exceeded", async () => {
      const agent = new BoltzPay({
        ...baseConfig,
        budget: { perTransaction: 0.05 },
      });

      // Quote returns $0.10, per-tx is $0.05
      mockProbeAll.mockResolvedValueOnce([makeProbeResult(10n)]);

      const errorListener = vi.fn();
      agent.on("error", errorListener);

      await expect(agent.fetch("https://paid.com/api")).rejects.toThrow(
        BudgetExceededError,
      );

      expect(errorListener).toHaveBeenCalledTimes(1);
      expect(errorListener.mock.calls[0][0]).toBeInstanceOf(
        BudgetExceededError,
      );
    });
  });

  describe("concurrent payment serialization", () => {
    it("should serialize concurrent fetch calls to prevent budget overspend", async () => {
      const agent = new BoltzPay({
        ...baseConfig,
        budget: { perTransaction: 1.0, daily: 1.5 },
      });

      mockProbeAll.mockResolvedValue([makeProbeResult(100n)]);
      mockExecute.mockResolvedValue(makeSuccessResult());

      const results = await Promise.allSettled([
        agent.fetch("https://paid.com/api1"),
        agent.fetch("https://paid.com/api2"),
      ]);

      const successes = results.filter((r) => r.status === "fulfilled");
      const failures = results.filter((r) => r.status === "rejected");

      // Exactly one should succeed, one should fail with BudgetExceededError
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      const rejection = failures[0] as PromiseRejectedResult;
      expect(rejection.reason).toBeInstanceOf(BudgetExceededError);

      // Budget should reflect exactly one payment
      const budget = agent.getBudget();
      expect(budget.dailySpent.cents).toBe(100n);
    });
  });

  describe("getBudget reflects spending", () => {
    it("should reflect correct spent/remaining after payments", async () => {
      const agent = new BoltzPay({
        ...baseConfig,
        budget: { daily: 5.0, monthly: 100.0 },
      });

      // Execute 2 payments of $1.00 each
      for (let i = 0; i < 2; i++) {
        mockProbeAll.mockResolvedValueOnce([makeProbeResult(100n)]);
        mockExecute.mockResolvedValueOnce(makeSuccessResult());
      }

      await agent.fetch("https://paid.com/api");
      await agent.fetch("https://paid.com/api");

      const budget = agent.getBudget();
      expect(budget.dailySpent.cents).toBe(200n); // $2.00
      expect(budget.monthlySpent.cents).toBe(200n); // $2.00
      expect(budget.dailyRemaining?.cents).toBe(300n); // $3.00 remaining of $5.00
      expect(budget.monthlyRemaining?.cents).toBe(9800n); // $98.00 remaining of $100.00
    });
  });
});
