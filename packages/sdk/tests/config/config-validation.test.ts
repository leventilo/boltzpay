import { describe, expect, it } from "vitest";
import {
  hasCoinbaseCredentials,
  validateConfig,
} from "../../src/config/schema";
import { ConfigurationError } from "../../src/errors/configuration-error";
import type { BoltzPayConfig } from "../../src/config/types";

const validBase = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

describe("Config Validation", () => {
  describe("valid configs", () => {
    it("accepts valid config with 3 Coinbase credentials", () => {
      const result = validateConfig(validBase);
      expect(result.coinbaseApiKeyId).toBe("test-key-id");
      expect(result.coinbaseApiKeySecret).toBe("test-key-secret");
      expect(result.coinbaseWalletSecret).toBe("test-wallet-secret");
    });

    it("accepts config with budget, defaults warningThreshold to 0.80", () => {
      const result = validateConfig({
        ...validBase,
        budget: { daily: 100, monthly: 1000 },
      });
      expect(result.budget).toBeDefined();
      expect(result.budget?.warningThreshold).toBe(0.8);
    });

    it('accepts network "base-sepolia"', () => {
      const result = validateConfig({ ...validBase, network: "base-sepolia" });
      expect(result.network).toBe("base-sepolia");
    });

    it('defaults network to "base"', () => {
      const result = validateConfig(validBase);
      expect(result.network).toBe("base");
    });

    it('defaults logLevel to "warn"', () => {
      const result = validateConfig(validBase);
      expect(result.logLevel).toBe("warn");
    });

    it("no budget means budget is undefined (unlimited)", () => {
      const result = validateConfig(validBase);
      expect(result.budget).toBeUndefined();
    });

    it('accepts preferredChains: ["svm"]', () => {
      const result = validateConfig({
        ...validBase,
        preferredChains: ["svm"],
      });
      expect(result.preferredChains).toEqual(["svm"]);
    });

    it('accepts preferredChains: ["evm", "svm"]', () => {
      const result = validateConfig({
        ...validBase,
        preferredChains: ["evm", "svm"],
      });
      expect(result.preferredChains).toEqual(["evm", "svm"]);
    });

    it("accepts config without preferredChains (field is optional)", () => {
      const result = validateConfig(validBase);
      expect(result.preferredChains).toBeUndefined();
    });

    it("strips extra fields silently (Zod default)", () => {
      const result = validateConfig({
        ...validBase,
        extraField: "should be removed",
      });
      expect((result as Record<string, unknown>)["extraField"]).toBeUndefined();
    });
  });

  describe("optional credentials", () => {
    it("accepts config without any Coinbase credentials", () => {
      const result = validateConfig({});
      expect(result.coinbaseApiKeyId).toBeUndefined();
      expect(result.coinbaseApiKeySecret).toBeUndefined();
      expect(result.coinbaseWalletSecret).toBeUndefined();
    });

    it("accepts config with partial Coinbase credentials", () => {
      const result = validateConfig({ coinbaseApiKeyId: "key-id" });
      expect(result.coinbaseApiKeyId).toBe("key-id");
      expect(result.coinbaseApiKeySecret).toBeUndefined();
    });

  });

  describe("hasCoinbaseCredentials", () => {
    it("returns true when all 3 Coinbase keys are present", () => {
      const config = validateConfig(validBase);
      expect(hasCoinbaseCredentials(config)).toBe(true);
    });

    it("returns false when no keys are present", () => {
      const config = validateConfig({});
      expect(hasCoinbaseCredentials(config)).toBe(false);
    });

    it("returns false when only some keys are present", () => {
      const config = validateConfig({
        coinbaseApiKeyId: "key-id",
        coinbaseApiKeySecret: "secret",
      });
      expect(hasCoinbaseCredentials(config)).toBe(false);
    });
  });

  describe("invalid values", () => {
    it("throws ConfigurationError for empty coinbaseApiKeyId", () => {
      expect(() =>
        validateConfig({ ...validBase, coinbaseApiKeyId: "" }),
      ).toThrow(ConfigurationError);
    });

    it("throws ConfigurationError for invalid network value", () => {
      expect(() =>
        validateConfig({ ...validBase, network: "ethereum" }),
      ).toThrow(ConfigurationError);
    });

    it("throws ConfigurationError for negative daily budget", () => {
      expect(() =>
        validateConfig({ ...validBase, budget: { daily: -10 } }),
      ).toThrow(ConfigurationError);
    });

    it("throws ConfigurationError for warningThreshold > 1", () => {
      expect(() =>
        validateConfig({
          ...validBase,
          budget: { daily: 100, warningThreshold: 1.5 },
        }),
      ).toThrow(ConfigurationError);
    });

    it("throws ConfigurationError for warningThreshold < 0", () => {
      expect(() =>
        validateConfig({
          ...validBase,
          budget: { daily: 100, warningThreshold: -0.1 },
        }),
      ).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError for invalid preferredChains value', () => {
      expect(() =>
        validateConfig({
          ...validBase,
          preferredChains: ["invalid"],
        }),
      ).toThrow(ConfigurationError);
    });

    it('ConfigurationError has code "invalid_config" with formatted issues', () => {
      try {
        validateConfig({ ...validBase, network: "invalid-network" });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        expect((err as ConfigurationError).code).toBe("invalid_config");
        expect((err as ConfigurationError).message).toContain("network");
      }
    });
  });

  describe("Phase 8: timeouts", () => {
    it("validates timeouts with partial fields and applies defaults", () => {
      const result = validateConfig({ timeouts: { detect: 5000 } });
      expect(result.timeouts).toBeDefined();
      expect(result.timeouts!.detect).toBe(5000);
      expect(result.timeouts!.quote).toBe(15_000);
      expect(result.timeouts!.payment).toBe(30_000);
    });

    it("rejects negative timeout values", () => {
      expect(() =>
        validateConfig({ timeouts: { detect: -1 } }),
      ).toThrow(ConfigurationError);
    });

    it("rejects non-integer timeout values", () => {
      expect(() =>
        validateConfig({ timeouts: { detect: 5.5 } }),
      ).toThrow(ConfigurationError);
    });

    it("applies all timeout defaults when timeouts is provided as empty object", () => {
      const result = validateConfig({ timeouts: {} });
      expect(result.timeouts!.detect).toBe(10_000);
      expect(result.timeouts!.quote).toBe(15_000);
      expect(result.timeouts!.payment).toBe(30_000);
    });

    it("provides default timeouts when not provided", () => {
      const result = validateConfig({});
      expect(result.timeouts).toEqual({
        detect: 10_000,
        quote: 15_000,
        payment: 30_000,
      });
    });
  });

  describe("Phase 8: maxAmountPerRequest", () => {
    it('validates string dollar amount "10.00"', () => {
      const result = validateConfig({ maxAmountPerRequest: "10.00" });
      expect(result.maxAmountPerRequest).toBe("10.00");
    });

    it("validates positive number amount", () => {
      const result = validateConfig({ maxAmountPerRequest: 5 });
      expect(result.maxAmountPerRequest).toBe(5);
    });

    it("rejects negative number", () => {
      expect(() =>
        validateConfig({ maxAmountPerRequest: -5 }),
      ).toThrow(ConfigurationError);
    });

    it("rejects invalid string format", () => {
      expect(() =>
        validateConfig({ maxAmountPerRequest: "abc" }),
      ).toThrow(ConfigurationError);
    });

    it("leaves maxAmountPerRequest undefined when not provided", () => {
      const result = validateConfig({});
      expect(result.maxAmountPerRequest).toBeUndefined();
    });
  });

  describe("Phase 8: allowlist / blocklist", () => {
    it("validates allowlist with domain strings", () => {
      const result = validateConfig({ allowlist: ["example.com"] });
      expect(result.allowlist).toEqual(["example.com"]);
    });

    it("validates blocklist with domain strings", () => {
      const result = validateConfig({ blocklist: ["evil.com"] });
      expect(result.blocklist).toEqual(["evil.com"]);
    });

    it("rejects allowlist with empty string", () => {
      expect(() =>
        validateConfig({ allowlist: [""] }),
      ).toThrow(ConfigurationError);
    });

    it("rejects blocklist with empty string", () => {
      expect(() =>
        validateConfig({ blocklist: [""] }),
      ).toThrow(ConfigurationError);
    });

    it("leaves allowlist/blocklist undefined when not provided", () => {
      const result = validateConfig({});
      expect(result.allowlist).toBeUndefined();
      expect(result.blocklist).toBeUndefined();
    });
  });

  describe("Phase 8: logFormat", () => {
    it('validates logFormat "json"', () => {
      const result = validateConfig({ logFormat: "json" });
      expect(result.logFormat).toBe("json");
    });

    it('validates logFormat "text"', () => {
      const result = validateConfig({ logFormat: "text" });
      expect(result.logFormat).toBe("text");
    });

    it('defaults logFormat to "text" when not provided', () => {
      const result = validateConfig({});
      expect(result.logFormat).toBe("text");
    });

    it("rejects invalid logFormat value", () => {
      expect(() =>
        validateConfig({ logFormat: "xml" }),
      ).toThrow(ConfigurationError);
    });
  });

  describe("Phase 8: ConfigurationError domain_blocked code", () => {
    it('accepts "domain_blocked" code', () => {
      const error = new ConfigurationError(
        "domain_blocked",
        "Domain evil.com is blocked by policy",
      );
      expect(error.code).toBe("domain_blocked");
      expect(error.message).toContain("evil.com");
      expect(error.statusCode).toBe(400);
      expect(error).toBeInstanceOf(ConfigurationError);
    });
  });

  describe("Phase 11: WalletSchema", () => {
    it("validates coinbase wallet config", () => {
      const result = validateConfig({
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
      expect(result.wallets).toHaveLength(1);
      expect(result.wallets![0]).toEqual(
        expect.objectContaining({ type: "coinbase", name: "prod" }),
      );
    });

    it("validates nwc wallet config", () => {
      const result = validateConfig({
        wallets: [
          {
            type: "nwc",
            name: "ln",
            nwcConnectionString: "nostr+walletconnect://relay.example.com",
          },
        ],
      });
      expect(result.wallets).toHaveLength(1);
      expect(result.wallets![0]).toEqual(
        expect.objectContaining({ type: "nwc", name: "ln" }),
      );
    });

    it("rejects invalid wallet type", () => {
      expect(() =>
        validateConfig({
          wallets: [{ type: "invalid", name: "x" }],
        }),
      ).toThrow(ConfigurationError);
    });

    it("rejects empty wallet name", () => {
      expect(() =>
        validateConfig({
          wallets: [
            {
              type: "coinbase",
              name: "",
              coinbaseApiKeyId: "k",
              coinbaseApiKeySecret: "s",
              coinbaseWalletSecret: "w",
            },
          ],
        }),
      ).toThrow(ConfigurationError);
    });

    it("validates wallets with networks array", () => {
      const result = validateConfig({
        wallets: [
          {
            type: "coinbase",
            name: "multi",
            coinbaseApiKeyId: "k",
            coinbaseApiKeySecret: "s",
            coinbaseWalletSecret: "w",
            networks: ["evm", "svm"],
          },
        ],
      });
      expect(result.wallets![0]).toEqual(
        expect.objectContaining({ networks: ["evm", "svm"] }),
      );
    });

    it("backward compat — no wallets + flat creds still works", () => {
      const result = validateConfig(validBase);
      expect(result.wallets).toBeUndefined();
      expect(result.coinbaseApiKeyId).toBe("test-key-id");
    });

    it("validates empty wallets array", () => {
      const result = validateConfig({ wallets: [] });
      expect(result.wallets).toEqual([]);
    });
  });

  describe("Phase 10: StorageSchema", () => {
    it('accepts storage: "file" shortcut', () => {
      const result = validateConfig({ storage: "file" });
      expect(result.storage).toBe("file");
    });

    it('accepts storage: "memory" shortcut', () => {
      const result = validateConfig({ storage: "memory" });
      expect(result.storage).toBe("memory");
    });

    it("accepts storage: { type: 'file', dir: '/tmp/test' }", () => {
      const result = validateConfig({
        storage: { type: "file", dir: "/tmp/test" },
      });
      expect(result.storage).toEqual(
        expect.objectContaining({ type: "file", dir: "/tmp/test" }),
      );
    });

    it("defaults maxHistoryRecords to 1000 for object config", () => {
      const result = validateConfig({ storage: { type: "file" } });
      expect((result.storage as { maxHistoryRecords: number }).maxHistoryRecords).toBe(1000);
    });

    it("accepts custom adapter (duck-typing)", () => {
      const customAdapter = {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
        keys: async () => [],
      };
      const result = validateConfig({ storage: customAdapter });
      expect(result.storage).toBe(customAdapter);
    });

    it("leaves storage undefined when not provided (default)", () => {
      const result = validateConfig({});
      expect(result.storage).toBeUndefined();
    });

    it("rejects invalid storage value", () => {
      expect(() =>
        validateConfig({ storage: "redis" }),
      ).toThrow(ConfigurationError);
    });

    it("existing persistence config still works (backward compat)", () => {
      const result = validateConfig({
        persistence: { enabled: true, directory: "/tmp" },
      });
      expect(result.persistence).toBeDefined();
      expect(result.persistence?.enabled).toBe(true);
    });
  });
});
