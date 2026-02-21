import { API_DIRECTORY, BoltzPay as BoltzPaySdk, Money } from "@boltzpay/sdk";
import { describe, expect, it, vi } from "vitest";
import { BoltzPayApi } from "../credentials/BoltzPayApi.credentials.js";
import {
  BoltzPay,
  createSdkFromCredentials,
  executeOperation,
} from "../nodes/BoltzPay/BoltzPay.node.js";

// Mock the SDK module
vi.mock("@boltzpay/sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@boltzpay/sdk")>("@boltzpay/sdk");
  return {
    ...actual,
    BoltzPay: vi.fn(),
  };
});

/**
 * Create a mock SDK instance with configurable method responses.
 */
function createMockSdk(
  overrides: {
    fetch?: ReturnType<typeof vi.fn>;
    quote?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return {
    fetch: overrides.fetch ?? vi.fn(),
    quote: overrides.quote ?? vi.fn(),
    discover: vi.fn(),
    getBudget: vi.fn(),
    getHistory: vi.fn(),
    getCapabilities: vi.fn(),
    getBalances: vi.fn(),
    on: vi.fn(),
    resetDailyBudget: vi.fn(),
  } as unknown as BoltzPaySdk;
}

describe("BoltzPay n8n node", () => {
  describe("Node description", () => {
    it("has correct displayName, name, group, and version", () => {
      const node = new BoltzPay();
      expect(node.description.displayName).toBe("BoltzPay");
      expect(node.description.name).toBe("boltzPay");
      expect(node.description.group).toEqual(["transform"]);
      expect(node.description.version).toBe(1);
    });

    it("has credential configuration with required: false", () => {
      const node = new BoltzPay();
      const creds = node.description.credentials;
      expect(creds).toHaveLength(1);
      const first = creds?.[0];
      expect(first).toBeDefined();
      expect(first?.name).toBe("boltzPayApi");
      expect(first?.required).toBe(false);
    });

    it("defines 4 operations in properties", () => {
      const node = new BoltzPay();
      const operationProp = node.description.properties.find(
        (p) => p.name === "operation",
      );
      expect(operationProp).toBeDefined();
      expect(operationProp?.type).toBe("options");
      const options = (
        operationProp as { options: readonly { value: string }[] }
      ).options;
      const values = options.map((o) => o.value);
      expect(values).toEqual(["fetch", "check", "quote", "discover"]);
    });

    it("has subtitle template showing current operation", () => {
      const node = new BoltzPay();
      expect(node.description.subtitle).toBe('={{$parameter["operation"]}}');
    });
  });

  describe("BoltzPayApi credential type", () => {
    it("has name boltzPayApi and correct displayName", () => {
      const cred = new BoltzPayApi();
      expect(cred.name).toBe("boltzPayApi");
      expect(cred.displayName).toBe("BoltzPay API");
    });

    it("has 3 properties: apiKeyId, apiKeySecret, walletSecret", () => {
      const cred = new BoltzPayApi();
      expect(cred.properties).toHaveLength(3);
      const names = cred.properties.map((p) => p.name);
      expect(names).toEqual(["apiKeyId", "apiKeySecret", "walletSecret"]);
    });

    it("has password fields for apiKeySecret and walletSecret", () => {
      const cred = new BoltzPayApi();
      const apiKeySecret = cred.properties.find(
        (p) => p.name === "apiKeySecret",
      );
      const walletSecret = cred.properties.find(
        (p) => p.name === "walletSecret",
      );
      expect(apiKeySecret).toBeDefined();
      expect(walletSecret).toBeDefined();
      expect(apiKeySecret?.typeOptions).toEqual({ password: true });
      expect(walletSecret?.typeOptions).toEqual({ password: true });
    });

    it("has all properties required", () => {
      const cred = new BoltzPayApi();
      for (const prop of cred.properties) {
        expect(prop.required).toBe(true);
      }
    });
  });

  describe("executeOperation — discover", () => {
    it("returns all directory entries when no category", async () => {
      const sdk = createMockSdk();
      const results = await executeOperation(sdk, { operation: "discover" });
      expect(results.length).toBe(API_DIRECTORY.length);
      expect(results[0]).toHaveProperty("name");
      expect(results[0]).toHaveProperty("url");
      expect(results[0]).toHaveProperty("protocol");
      expect(results[0]).toHaveProperty("category");
      expect(results[0]).toHaveProperty("description");
      expect(results[0]).toHaveProperty("pricing");
    });

    it("filters entries by category", async () => {
      const sdk = createMockSdk();
      const results = await executeOperation(sdk, {
        operation: "discover",
        category: "demo",
      });
      expect(results.length).toBeGreaterThan(0);
      for (const entry of results) {
        expect(entry.category).toBe("demo");
      }
      // Should be less than the full directory
      expect(results.length).toBeLessThan(API_DIRECTORY.length);
    });

    it("returns empty array for non-existent category", async () => {
      const sdk = createMockSdk();
      const results = await executeOperation(sdk, {
        operation: "discover",
        category: "non-existent-category",
      });
      expect(results).toEqual([]);
    });
  });

  describe("executeOperation — check", () => {
    it("returns isPaid: false when quote throws", async () => {
      const sdk = createMockSdk({
        quote: vi.fn().mockRejectedValue(new Error("No protocol detected")),
      });
      const results = await executeOperation(sdk, {
        operation: "check",
        url: "https://example.com/free-api",
      });
      expect(results).toEqual([{ isPaid: false }]);
    });

    it("returns isPaid: true with quote data when quote succeeds", async () => {
      const sdk = createMockSdk({
        quote: vi.fn().mockResolvedValue({
          protocol: "x402",
          amount: Money.fromDollars("0.05"),
          network: "eip155:8453",
          allAccepts: undefined,
        }),
      });
      const results = await executeOperation(sdk, {
        operation: "check",
        url: "https://invy.bot/api",
      });
      expect(results).toEqual([
        {
          isPaid: true,
          protocol: "x402",
          amount: "$0.05",
          network: "eip155:8453",
        },
      ]);
    });

    it("throws when URL is missing", async () => {
      const sdk = createMockSdk();
      await expect(
        executeOperation(sdk, { operation: "check" }),
      ).rejects.toThrow("URL is required for check operation");
    });
  });

  describe("executeOperation — quote", () => {
    it("returns quote data with allAccepts", async () => {
      const sdk = createMockSdk({
        quote: vi.fn().mockResolvedValue({
          protocol: "x402",
          amount: Money.fromDollars("0.25"),
          network: "eip155:8453",
          allAccepts: [
            { network: "eip155:8453", amount: 25n },
            { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: 25n },
          ],
        }),
      });
      const results = await executeOperation(sdk, {
        operation: "quote",
        url: "https://emc2ai.io/x402/bitquery/top-tokens",
      });
      expect(results).toHaveLength(1);
      expect(results[0].protocol).toBe("x402");
      expect(results[0].amount).toBe("$0.25");
      expect(results[0].allAccepts).toEqual([
        { network: "eip155:8453", amount: "$0.25" },
        { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: "$0.25" },
      ]);
    });

    it("returns null allAccepts when not multi-chain", async () => {
      const sdk = createMockSdk({
        quote: vi.fn().mockResolvedValue({
          protocol: "x402",
          amount: Money.fromDollars("0.05"),
          network: "eip155:8453",
          allAccepts: undefined,
        }),
      });
      const results = await executeOperation(sdk, {
        operation: "quote",
        url: "https://invy.bot/api",
      });
      expect(results[0].allAccepts).toBeNull();
    });
  });

  describe("executeOperation — fetch", () => {
    it("returns response data with payment info", async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        payment: {
          protocol: "x402",
          amount: Money.fromDollars("0.05"),
          url: "https://invy.bot/api",
          txHash: "0xabc123",
          timestamp: new Date(),
        },
        text: vi.fn().mockResolvedValue('{"data": "token holdings"}'),
      };
      const sdk = createMockSdk({
        fetch: vi.fn().mockResolvedValue(mockResponse),
      });

      const results = await executeOperation(sdk, {
        operation: "fetch",
        url: "https://invy.bot/api",
        method: "GET",
        chain: "auto",
      });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      expect(results[0].body).toBe('{"data": "token holdings"}');
      expect(results[0].payment).toEqual({
        protocol: "x402",
        amount: "$0.05",
        url: "https://invy.bot/api",
        txHash: "0xabc123",
      });
    });

    it("returns null payment for passthrough response", async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        payment: null,
        text: vi.fn().mockResolvedValue("free content"),
      };
      const sdk = createMockSdk({
        fetch: vi.fn().mockResolvedValue(mockResponse),
      });

      const results = await executeOperation(sdk, {
        operation: "fetch",
        url: "https://example.com/free",
        method: "GET",
        chain: "auto",
      });

      expect(results[0].payment).toBeNull();
      expect(results[0].body).toBe("free content");
    });

    it("passes chain override when not auto", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        payment: null,
        text: vi.fn().mockResolvedValue("data"),
      });
      const sdk = createMockSdk({ fetch: mockFetch });

      await executeOperation(sdk, {
        operation: "fetch",
        url: "https://example.com",
        method: "POST",
        chain: "evm",
      });

      expect(mockFetch).toHaveBeenCalledWith("https://example.com", {
        method: "POST",
        chain: "evm",
      });
    });

    it("passes undefined chain for auto selection", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        payment: null,
        text: vi.fn().mockResolvedValue("data"),
      });
      const sdk = createMockSdk({ fetch: mockFetch });

      await executeOperation(sdk, {
        operation: "fetch",
        url: "https://example.com",
        method: "GET",
        chain: "auto",
      });

      expect(mockFetch).toHaveBeenCalledWith("https://example.com", {
        method: "GET",
        chain: undefined,
      });
    });

    it("throws when URL is missing", async () => {
      const sdk = createMockSdk();
      await expect(
        executeOperation(sdk, { operation: "fetch", method: "GET" }),
      ).rejects.toThrow("URL is required for fetch operation");
    });
  });

  describe("Operation routing", () => {
    it("routes each operation to the correct SDK method", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        payment: null,
        text: vi.fn().mockResolvedValue("data"),
      });
      const mockQuote = vi.fn().mockResolvedValue({
        protocol: "x402",
        amount: Money.fromDollars("0.01"),
        network: null,
      });

      const sdk = createMockSdk({
        fetch: mockFetch,
        quote: mockQuote,
      });

      // fetch calls sdk.fetch
      await executeOperation(sdk, {
        operation: "fetch",
        url: "https://example.com",
        method: "GET",
        chain: "auto",
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // check calls sdk.quote
      await executeOperation(sdk, {
        operation: "check",
        url: "https://example.com",
      });
      expect(mockQuote).toHaveBeenCalledTimes(1);

      // quote calls sdk.quote
      await executeOperation(sdk, {
        operation: "quote",
        url: "https://example.com",
      });
      expect(mockQuote).toHaveBeenCalledTimes(2);

      // discover does NOT call any SDK method (uses filterDirectory directly)
      await executeOperation(sdk, { operation: "discover" });
      // No additional SDK calls
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockQuote).toHaveBeenCalledTimes(2);
    });
  });

  describe("createSdkFromCredentials", () => {
    it("creates SDK with credentials when provided", () => {
      const MockBoltzPay = vi.mocked(BoltzPaySdk);
      MockBoltzPay.mockImplementation(
        () => createMockSdk() as unknown as BoltzPaySdk,
      );

      createSdkFromCredentials({
        apiKeyId: "key-id",
        apiKeySecret: "key-secret",
        walletSecret: "wallet-secret",
      });

      expect(MockBoltzPay).toHaveBeenCalledWith({
        coinbaseApiKeyId: "key-id",
        coinbaseApiKeySecret: "key-secret",
        coinbaseWalletSecret: "wallet-secret",
      });
    });

    it("creates SDK without credentials for read-only mode", () => {
      const MockBoltzPay = vi.mocked(BoltzPaySdk);
      MockBoltzPay.mockImplementation(
        () => createMockSdk() as unknown as BoltzPaySdk,
      );

      createSdkFromCredentials(null);

      expect(MockBoltzPay).toHaveBeenCalledWith({});
    });
  });

  describe("Unknown operation", () => {
    it("throws for unknown operation type", async () => {
      const sdk = createMockSdk();
      await expect(
        executeOperation(sdk, { operation: "invalid" }),
      ).rejects.toThrow("Unknown operation: invalid");
    });
  });
});
