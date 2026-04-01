import { BoltzPay as BoltzPaySdk, Money } from "@boltzpay/sdk";
import { describe, expect, it, vi } from "vitest";
import { BoltzPayApi } from "../credentials/BoltzPayApi.credentials.js";
import {
  BoltzPay,
  createSdkFromCredentials,
  executeOperation,
} from "../nodes/BoltzPay/BoltzPay.node.js";

vi.mock("@boltzpay/sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@boltzpay/sdk")>("@boltzpay/sdk");
  return {
    ...actual,
    BoltzPay: vi.fn(),
  };
});

function createMockSdk(
  overrides: {
    fetch?: ReturnType<typeof vi.fn>;
    quote?: ReturnType<typeof vi.fn>;
    diagnose?: ReturnType<typeof vi.fn>;
    getBudget?: ReturnType<typeof vi.fn>;
    getHistory?: ReturnType<typeof vi.fn>;
    getWalletStatus?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return {
    fetch: overrides.fetch ?? vi.fn(),
    quote: overrides.quote ?? vi.fn(),
    diagnose: overrides.diagnose ?? vi.fn(),
    getBudget:
      overrides.getBudget ??
      vi.fn().mockReturnValue({
        dailyLimit: undefined,
        monthlyLimit: undefined,
        perTransactionLimit: undefined,
        dailySpent: Money.fromDollars("0"),
        monthlySpent: Money.fromDollars("0"),
      }),
    getHistory: overrides.getHistory ?? vi.fn().mockReturnValue([]),
    getWalletStatus: overrides.getWalletStatus ?? vi.fn(),
    discover: vi.fn().mockResolvedValue([]),
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

    it("defines 7 operations in properties", () => {
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
      expect(values).toEqual([
        "fetch",
        "quote",
        "discover",
        "diagnose",
        "budget",
        "history",
        "wallet",
      ]);
    });

    it("has subtitle template showing current operation", () => {
      const node = new BoltzPay();
      expect(node.description.subtitle).toBe('={{$parameter["operation"]}}');
    });

    it("shows URL field for diagnose operation", () => {
      const node = new BoltzPay();
      const urlProp = node.description.properties.find((p) => p.name === "url");
      const showOps = urlProp?.displayOptions?.show?.operation as string[];
      expect(showOps).toContain("diagnose");
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
    it("returns registry entries when no category", async () => {
      const sdk = createMockSdk();
      const mockEntries = [
        { slug: "test-api", name: "Test API", url: "https://test.com", protocol: "x402", score: 85, health: "healthy", category: "crypto-data", isPaid: true, badge: null },
        { slug: "other-api", name: "Other API", url: "https://other.com", protocol: "mpp", score: 72, health: "healthy", category: "ai", isPaid: true, badge: "new" },
      ];
      (sdk.discover as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntries);
      const results = await executeOperation(sdk, { operation: "discover" });
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty("name");
      expect(results[0]).toHaveProperty("url");
      expect(results[0]).toHaveProperty("protocol");
      expect(results[0]).toHaveProperty("category");
      expect(results[0]).toHaveProperty("score");
      expect(results[0]).toHaveProperty("health");
    });

    it("passes category to sdk.discover", async () => {
      const sdk = createMockSdk();
      const mockEntries = [
        { slug: "demo-api", name: "Demo", url: "https://demo.com", protocol: "x402", score: 60, health: "healthy", category: "demo", isPaid: true, badge: null },
      ];
      (sdk.discover as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntries);
      const results = await executeOperation(sdk, {
        operation: "discover",
        category: "demo",
      });
      expect(results).toHaveLength(1);
      expect(results[0].category).toBe("demo");
      expect(sdk.discover).toHaveBeenCalledWith(
        expect.objectContaining({ category: "demo" }),
      );
    });

    it("returns empty array for non-existent category", async () => {
      const sdk = createMockSdk();
      (sdk.discover as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const results = await executeOperation(sdk, {
        operation: "discover",
        category: "non-existent-category",
      });
      expect(results).toEqual([]);
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

  describe("executeOperation — diagnose", () => {
    it("returns formatted diagnosis for a paid endpoint", async () => {
      const sdk = createMockSdk({
        diagnose: vi.fn().mockResolvedValue({
          url: "https://invy.bot/api",
          classification: "x402_paid",
          isPaid: true,
          health: "live",
          latencyMs: 245,
          protocol: "x402",
          formatVersion: "v1_body",
          scheme: "exact",
          network: "eip155:8453",
          price: Money.fromDollars("0.05"),
          facilitator: "0xfac1...1234",
          postOnly: false,
          chains: [
            {
              namespace: "evm",
              network: "eip155:8453",
              price: Money.fromDollars("0.05"),
              scheme: "exact",
            },
          ],
          timing: { dns: 12, get: 180, post: 53 },
        }),
      });

      const results = await executeOperation(sdk, {
        operation: "diagnose",
        url: "https://invy.bot/api",
      });

      expect(results).toHaveLength(1);
      expect(results[0].url).toBe("https://invy.bot/api");
      expect(results[0].classification).toBe("x402_paid");
      expect(results[0].isPaid).toBe(true);
      expect(results[0].health).toBe("live");
      expect(results[0].latencyMs).toBe(245);
      expect(results[0].protocol).toBe("x402");
      expect(results[0].price).toBe("$0.05");
      expect(results[0].facilitator).toBe("0xfac1...1234");
      expect(results[0].chains).toEqual([
        {
          namespace: "evm",
          network: "eip155:8453",
          price: "$0.05",
          scheme: "exact",
        },
      ]);
      expect(results[0].timing).toEqual({ dns: 12, get: 180, post: 53 });
    });

    it("returns minimal output for a free endpoint", async () => {
      const sdk = createMockSdk({
        diagnose: vi.fn().mockResolvedValue({
          url: "https://example.com/free",
          classification: "free_confirmed",
          isPaid: false,
          health: "live",
          latencyMs: 100,
          protocol: undefined,
          formatVersion: undefined,
          scheme: undefined,
          network: undefined,
          price: undefined,
          facilitator: undefined,
          postOnly: false,
          httpStatus: 200,
        }),
      });

      const results = await executeOperation(sdk, {
        operation: "diagnose",
        url: "https://example.com/free",
      });

      expect(results).toHaveLength(1);
      expect(results[0].classification).toBe("free_confirmed");
      expect(results[0].isPaid).toBe(false);
      expect(results[0].httpStatus).toBe(200);
      expect(results[0]).not.toHaveProperty("protocol");
      expect(results[0]).not.toHaveProperty("price");
    });

    it("returns error object when diagnosis fails", async () => {
      const sdk = createMockSdk({
        diagnose: vi.fn().mockRejectedValue(new Error("DNS resolution failed")),
      });

      const results = await executeOperation(sdk, {
        operation: "diagnose",
        url: "https://dead.example.com",
      });

      expect(results).toHaveLength(1);
      expect(results[0].url).toBe("https://dead.example.com");
      expect(results[0].error).toBe("DNS resolution failed");
    });

    it("throws when URL is missing", async () => {
      const sdk = createMockSdk();
      await expect(
        executeOperation(sdk, { operation: "diagnose" }),
      ).rejects.toThrow("URL is required for diagnose operation");
    });
  });

  describe("executeOperation — budget", () => {
    it("returns configured: false when no limits set", async () => {
      const sdk = createMockSdk({
        getBudget: vi.fn().mockReturnValue({
          dailyLimit: undefined,
          monthlyLimit: undefined,
          perTransactionLimit: undefined,
          dailySpent: Money.fromDollars("0"),
          monthlySpent: Money.fromDollars("0"),
        }),
      });

      const results = await executeOperation(sdk, { operation: "budget" });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ configured: false });
    });

    it("returns daily budget status", async () => {
      const sdk = createMockSdk({
        getBudget: vi.fn().mockReturnValue({
          dailyLimit: Money.fromDollars("10"),
          dailySpent: Money.fromDollars("3.50"),
          dailyRemaining: Money.fromDollars("6.50"),
          monthlyLimit: undefined,
          perTransactionLimit: undefined,
          monthlySpent: Money.fromDollars("0"),
        }),
      });

      const results = await executeOperation(sdk, { operation: "budget" });

      expect(results).toHaveLength(1);
      expect(results[0].configured).toBe(true);
      const daily = results[0].daily as {
        limit: string;
        spent: string;
        remaining: string;
      };
      expect(daily.limit).toBe("$10.00");
      expect(daily.spent).toBe("$3.50");
      expect(daily.remaining).toBe("$6.50");
    });

    it("returns monthly and per-transaction limits", async () => {
      const sdk = createMockSdk({
        getBudget: vi.fn().mockReturnValue({
          dailyLimit: undefined,
          monthlyLimit: Money.fromDollars("100"),
          monthlySpent: Money.fromDollars("25"),
          monthlyRemaining: Money.fromDollars("75"),
          perTransactionLimit: Money.fromDollars("5"),
          dailySpent: Money.fromDollars("0"),
        }),
      });

      const results = await executeOperation(sdk, { operation: "budget" });

      expect(results).toHaveLength(1);
      expect(results[0].configured).toBe(true);
      const monthly = results[0].monthly as {
        limit: string;
        spent: string;
        remaining: string;
      };
      expect(monthly.limit).toBe("$100.00");
      expect(monthly.spent).toBe("$25.00");
      expect(monthly.remaining).toBe("$75.00");
      const perTx = results[0].perTransaction as { limit: string };
      expect(perTx.limit).toBe("$5.00");
    });
  });

  describe("executeOperation — history", () => {
    it("returns empty state when no payments", async () => {
      const sdk = createMockSdk({
        getHistory: vi.fn().mockReturnValue([]),
      });

      const results = await executeOperation(sdk, { operation: "history" });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ payments: [], count: 0 });
    });

    it("returns formatted payment records", async () => {
      const timestamp = new Date("2026-03-10T12:00:00Z");
      const sdk = createMockSdk({
        getHistory: vi.fn().mockReturnValue([
          {
            url: "https://invy.bot/api",
            protocol: "x402",
            amount: Money.fromDollars("0.05"),
            network: "eip155:8453",
            timestamp,
            txHash: "0xabc123",
          },
          {
            url: "https://satring.com/api",
            protocol: "L402",
            amount: Money.fromDollars("0.01"),
            network: undefined,
            timestamp,
            txHash: null,
          },
        ]),
      });

      const results = await executeOperation(sdk, { operation: "history" });

      expect(results).toHaveLength(2);
      expect(results[0].url).toBe("https://invy.bot/api");
      expect(results[0].protocol).toBe("x402");
      expect(results[0].amount).toBe("$0.05");
      expect(results[0].chain).toBe("Base");
      expect(results[0].network).toBe("eip155:8453");
      expect(results[0].timestamp).toBe("2026-03-10T12:00:00.000Z");
      expect(results[0].txHash).toBe("0xabc123");
      expect(results[1].network).toBeNull();
      expect(results[1].txHash).toBeNull();
    });
  });

  describe("executeOperation — wallet", () => {
    it("returns wallet status with accounts", async () => {
      const sdk = createMockSdk({
        getWalletStatus: vi.fn().mockResolvedValue({
          network: "mainnet",
          isTestnet: false,
          protocols: ["x402"],
          canPay: true,
          credentials: { configured: true, valid: true },
          connection: { status: "connected", latencyMs: 50 },
          accounts: {
            evm: {
              address: "0x1234567890abcdef",
              balance: Money.fromDollars("12.50"),
            },
            svm: null,
          },
          budget: {
            dailyLimit: undefined,
            monthlyLimit: undefined,
            perTransactionLimit: undefined,
            dailySpent: Money.fromDollars("0"),
            monthlySpent: Money.fromDollars("0"),
          },
        }),
        getBudget: vi.fn().mockReturnValue({
          dailyLimit: undefined,
          monthlyLimit: undefined,
          perTransactionLimit: undefined,
          dailySpent: Money.fromDollars("0"),
          monthlySpent: Money.fromDollars("0"),
        }),
      });

      const results = await executeOperation(sdk, { operation: "wallet" });

      expect(results).toHaveLength(1);
      expect(results[0].network).toBe("mainnet");
      expect(results[0].isTestnet).toBe(false);
      expect(results[0].canPay).toBe(true);
      const accounts = results[0].accounts as {
        evm: { address: string; balance: string } | null;
        svm: { address: string; balance: string } | null;
      };
      expect(accounts.evm?.address).toBe("0x1234567890abcdef");
      expect(accounts.evm?.balance).toBe("$12.50");
      expect(accounts.svm).toBeNull();
    });

    it("returns wallet status without credentials", async () => {
      const sdk = createMockSdk({
        getWalletStatus: vi.fn().mockResolvedValue({
          network: "mainnet",
          isTestnet: false,
          protocols: [],
          canPay: false,
          credentials: { configured: false, valid: false },
          connection: { status: "disconnected", latencyMs: null },
          accounts: { evm: null, svm: null },
          budget: {
            dailyLimit: undefined,
            monthlyLimit: undefined,
            perTransactionLimit: undefined,
            dailySpent: Money.fromDollars("0"),
            monthlySpent: Money.fromDollars("0"),
          },
        }),
        getBudget: vi.fn().mockReturnValue({
          dailyLimit: undefined,
          monthlyLimit: undefined,
          perTransactionLimit: undefined,
          dailySpent: Money.fromDollars("0"),
          monthlySpent: Money.fromDollars("0"),
        }),
      });

      const results = await executeOperation(sdk, { operation: "wallet" });

      expect(results).toHaveLength(1);
      expect(results[0].canPay).toBe(false);
      const accounts = results[0].accounts as {
        evm: null;
        svm: null;
      };
      expect(accounts.evm).toBeNull();
      expect(accounts.svm).toBeNull();
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
      const mockDiagnose = vi.fn().mockResolvedValue({
        url: "https://example.com",
        classification: "free_confirmed",
        isPaid: false,
        health: "live",
        latencyMs: 100,
        protocol: undefined,
        formatVersion: undefined,
        scheme: undefined,
        network: undefined,
        price: undefined,
        facilitator: undefined,
        postOnly: false,
      });

      const sdk = createMockSdk({
        fetch: mockFetch,
        quote: mockQuote,
        diagnose: mockDiagnose,
      });

      await executeOperation(sdk, {
        operation: "fetch",
        url: "https://example.com",
        method: "GET",
        chain: "auto",
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await executeOperation(sdk, {
        operation: "quote",
        url: "https://example.com",
      });
      expect(mockQuote).toHaveBeenCalledTimes(1);

      await executeOperation(sdk, { operation: "discover" });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockQuote).toHaveBeenCalledTimes(1);

      await executeOperation(sdk, {
        operation: "diagnose",
        url: "https://example.com",
      });
      expect(mockDiagnose).toHaveBeenCalledTimes(1);
    });
  });

  describe("createSdkFromCredentials", () => {
    it("creates SDK with credentials when provided", () => {
      const MockBoltzPay = vi.mocked(BoltzPaySdk);
      // biome-ignore lint/complexity/useArrowFunction: constructor mock requires regular function
      MockBoltzPay.mockImplementation(function () {
        return createMockSdk() as unknown as BoltzPaySdk;
      });

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
      // biome-ignore lint/complexity/useArrowFunction: constructor mock requires regular function
      MockBoltzPay.mockImplementation(function () {
        return createMockSdk() as unknown as BoltzPaySdk;
      });

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
