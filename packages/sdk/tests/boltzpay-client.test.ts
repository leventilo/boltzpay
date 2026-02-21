import { Money } from "@boltzpay/core";
import { describe, expect, it, vi } from "vitest";

// Mock @coinbase/cdp-sdk and @boltzpay/protocols to prevent real imports
// BoltzPay constructor creates CdpWalletManager which may trigger heavy imports
vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {
    constructor() {}
  },
}));

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
    constructor() {}
    probeAll() {
      return Promise.reject(new Error("Not implemented in test"));
    }
    execute() {
      return Promise.reject(new Error("Not implemented in test"));
    }
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

// Import AFTER mocks are set up
import { BoltzPay } from "../src/boltzpay";
import { ConfigurationError } from "../src/errors/configuration-error";

const validConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

describe("BoltzPay", () => {
  describe("constructor", () => {
    it("valid config does not throw", () => {
      expect(() => new BoltzPay(validConfig)).not.toThrow();
    });

    it("accepts config without Coinbase credentials (read-only mode)", () => {
      const sdk = new BoltzPay({});
      const caps = sdk.getCapabilities();
      expect(caps.canPay).toBe(false);
      expect(caps.protocols).toContain("x402");
    });

    it("invalid config throws ConfigurationError", () => {
      expect(
        () =>
          new BoltzPay({
            ...validConfig,
            network: "invalid" as "base",
          }),
      ).toThrow(ConfigurationError);
    });
  });

  describe("initial state", () => {
    it("getHistory() returns empty array initially", () => {
      const client = new BoltzPay(validConfig);
      expect(client.getHistory()).toEqual([]);
    });

    it("getBudget() returns correct initial state (zero spent)", () => {
      const client = new BoltzPay(validConfig);
      const budget = client.getBudget();
      expect(budget.dailySpent.isZero()).toBe(true);
      expect(budget.monthlySpent.isZero()).toBe(true);
    });

    it("resetDailyBudget() works without error", () => {
      const client = new BoltzPay(validConfig);
      expect(() => client.resetDailyBudget()).not.toThrow();
    });

    it('on("payment", cb) registers without error', () => {
      const client = new BoltzPay(validConfig);
      const cb = vi.fn();
      expect(() => client.on("payment", cb)).not.toThrow();
    });
  });

  describe("config with budget", () => {
    it("getBudget() reflects configured limits", () => {
      const client = new BoltzPay({
        ...validConfig,
        budget: { daily: 100, monthly: 1000, perTransaction: 50 },
      });
      const budget = client.getBudget();
      expect(budget.dailyLimit?.equals(Money.fromDollars("100.00"))).toBe(true);
      expect(budget.monthlyLimit?.equals(Money.fromDollars("1000.00"))).toBe(
        true,
      );
      expect(
        budget.perTransactionLimit?.equals(Money.fromDollars("50.00")),
      ).toBe(true);
      expect(budget.dailyRemaining?.equals(Money.fromDollars("100.00"))).toBe(
        true,
      );
      expect(
        budget.monthlyRemaining?.equals(Money.fromDollars("1000.00")),
      ).toBe(true);
    });

    it("config without budget has undefined remaining", () => {
      const client = new BoltzPay(validConfig);
      const budget = client.getBudget();
      expect(budget.dailyLimit).toBeUndefined();
      expect(budget.monthlyLimit).toBeUndefined();
      expect(budget.perTransactionLimit).toBeUndefined();
      expect(budget.dailyRemaining).toBeUndefined();
      expect(budget.monthlyRemaining).toBeUndefined();
    });
  });
});
