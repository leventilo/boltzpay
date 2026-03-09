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

  describe("domain policy", () => {
    it("allowlist blocks domains not in the list", async () => {
      const client = new BoltzPay({
        ...validConfig,
        allowlist: ["example.com"],
      });

      await expect(client.fetch("https://evil.com/api")).rejects.toThrow(
        ConfigurationError,
      );
      try {
        await client.fetch("https://evil.com/api");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        expect((err as ConfigurationError).code).toBe("domain_blocked");
      }
    });

    it("allowlist permits subdomains of allowed domains", async () => {
      const client = new BoltzPay({
        ...validConfig,
        allowlist: ["example.com"],
      });

      // sub.example.com should NOT throw domain_blocked — it should proceed to probing
      // The probe will fail because our mock router rejects, but the domain check should pass
      try {
        await client.fetch("https://sub.example.com/api");
      } catch (err) {
        // Should NOT be a ConfigurationError with domain_blocked
        expect(err).not.toBeInstanceOf(ConfigurationError);
      }
    });

    it("blocklist blocks matching domains", async () => {
      const client = new BoltzPay({
        ...validConfig,
        blocklist: ["evil.com"],
      });

      await expect(client.fetch("https://evil.com/api")).rejects.toThrow(
        ConfigurationError,
      );
      try {
        await client.fetch("https://evil.com/api");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        expect((err as ConfigurationError).code).toBe("domain_blocked");
      }
    });

    it("blocklist allows non-matching domains", async () => {
      const client = new BoltzPay({
        ...validConfig,
        blocklist: ["evil.com"],
      });

      // good.com should NOT throw domain_blocked
      try {
        await client.fetch("https://good.com/api");
      } catch (err) {
        expect(err).not.toBeInstanceOf(ConfigurationError);
      }
    });

    it("allowlist takes precedence over blocklist when both are set", async () => {
      const client = new BoltzPay({
        ...validConfig,
        allowlist: ["example.com"],
        blocklist: ["example.com"],
      });

      // example.com is in allowlist, so blocklist should be ignored — no domain_blocked error
      try {
        await client.fetch("https://example.com/api");
      } catch (err) {
        expect(err).not.toBeInstanceOf(ConfigurationError);
      }
    });

    it("domain policy applies to quote() as well", async () => {
      const client = new BoltzPay({
        ...validConfig,
        allowlist: ["example.com"],
      });

      await expect(client.quote("https://evil.com/api")).rejects.toThrow(
        ConfigurationError,
      );
    });
  });

  describe("maxAmountPerRequest", () => {
    it("constructs successfully with maxAmountPerRequest config", () => {
      expect(
        () =>
          new BoltzPay({
            ...validConfig,
            maxAmountPerRequest: "5.00",
          }),
      ).not.toThrow();
    });
  });

  describe("timeouts", () => {
    it("constructs successfully with custom timeouts config", () => {
      expect(
        () =>
          new BoltzPay({
            ...validConfig,
            timeouts: { detect: 3000, quote: 5000, payment: 10000 },
          }),
      ).not.toThrow();
    });
  });

  describe("logFormat", () => {
    it("constructs successfully with json logFormat", () => {
      expect(
        () =>
          new BoltzPay({
            ...validConfig,
            logFormat: "json",
          }),
      ).not.toThrow();
    });
  });

  describe("multi-wallet resolution", () => {
    it("flat coinbaseApiKeyId creates implicit 'default' wallet — canPay is true", () => {
      const client = new BoltzPay(validConfig);
      const caps = client.getCapabilities();
      expect(caps.canPay).toBe(true);
    });

    it("flat nwcConnectionString creates implicit 'default-nwc' wallet — canPayLightning is true", () => {
      const client = new BoltzPay({
        nwcConnectionString: "nostr+walletconnect://relay.example.com",
      });
      const caps = client.getCapabilities();
      expect(caps.canPayLightning).toBe(true);
    });

    it("both flat creds create two wallets (canPay + canPayLightning)", () => {
      const client = new BoltzPay({
        ...validConfig,
        nwcConnectionString: "nostr+walletconnect://relay.example.com",
      });
      const caps = client.getCapabilities();
      expect(caps.canPay).toBe(true);
      expect(caps.canPayLightning).toBe(true);
      expect(caps.protocols).toContain("x402");
      expect(caps.protocols).toContain("l402");
    });

    it("wallets[] with one named coinbase wallet — canPay is true", () => {
      const client = new BoltzPay({
        wallets: [
          {
            type: "coinbase",
            name: "prod",
            coinbaseApiKeyId: "key-id",
            coinbaseApiKeySecret: "key-secret",
            coinbaseWalletSecret: "wallet-secret",
          },
        ],
      });
      const caps = client.getCapabilities();
      expect(caps.canPay).toBe(true);
    });

    it("wallets: [] creates zero wallets — canPay and canPayLightning are false", () => {
      const client = new BoltzPay({ wallets: [] });
      const caps = client.getCapabilities();
      expect(caps.canPay).toBe(false);
      expect(caps.canPayLightning).toBe(false);
    });

    it("wallets[] takes precedence over flat credentials", () => {
      const client = new BoltzPay({
        ...validConfig, // flat coinbase creds
        wallets: [], // explicit empty = no wallets
      });
      const caps = client.getCapabilities();
      // wallets[] wins → no wallets despite flat creds
      expect(caps.canPay).toBe(false);
    });

    it("getCapabilities() chains reflects actual wallet networks, not hardcoded SUPPORTED_NAMESPACES", () => {
      // Wallet limited to evm only
      const client = new BoltzPay({
        wallets: [
          {
            type: "coinbase",
            name: "evm-only",
            coinbaseApiKeyId: "k",
            coinbaseApiKeySecret: "s",
            coinbaseWalletSecret: "w",
            networks: ["evm"],
          },
        ],
      });
      const caps = client.getCapabilities();
      expect(caps.chains).toContain("evm");
      expect(caps.chains).not.toContain("svm");
      expect(caps.chains).not.toContain("stellar");
    });

    it("close() closes all NWC wallets", () => {
      const client = new BoltzPay({
        nwcConnectionString: "nostr+walletconnect://relay.example.com",
      });
      // Should not throw
      expect(() => client.close()).not.toThrow();
    });

    it("wallets[] with nwc wallet — canPayLightning is true", () => {
      const client = new BoltzPay({
        wallets: [
          {
            type: "nwc",
            name: "ln-wallet",
            nwcConnectionString: "nostr+walletconnect://relay.example.com",
          },
        ],
      });
      const caps = client.getCapabilities();
      expect(caps.canPayLightning).toBe(true);
    });

    it("wildcard wallet (networks: undefined) includes evm and svm in chains", () => {
      const client = new BoltzPay(validConfig); // flat creds = networks: undefined
      const caps = client.getCapabilities();
      expect(caps.chains).toContain("evm");
      expect(caps.chains).toContain("svm");
    });
  });
});
