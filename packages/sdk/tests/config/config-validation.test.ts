import { describe, expect, it } from "vitest";
import {
  hasCoinbaseCredentials,
  validateConfig,
} from "../../src/config/schema";
import { ConfigurationError } from "../../src/errors/configuration-error";

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
});
