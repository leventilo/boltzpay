import { BoltzPay, type DiscoveredEntry, ProtocolError } from "@boltzpay/sdk";
import { describe, expect, it, vi } from "vitest";
import { boltzpayTools } from "../src/index";

const TOOL_KEYS = [
  "boltzpay_fetch",
  "boltzpay_check",
  "boltzpay_diagnose",
  "boltzpay_quote",
  "boltzpay_discover",
  "boltzpay_budget",
  "boltzpay_history",
  "boltzpay_wallet",
] as const;

describe("boltzpayTools factory", () => {
  it("returns an object with all 8 tool keys", () => {
    const tools = boltzpayTools();
    for (const key of TOOL_KEYS) {
      expect(tools).toHaveProperty(key);
    }
    expect(Object.keys(tools)).toHaveLength(8);
  });

  it("creates default SDK instance with no args (read-only mode)", () => {
    const tools = boltzpayTools();
    expect(tools.boltzpay_fetch).toBeDefined();
  });

  it("accepts a pre-built BoltzPay instance", () => {
    const sdk = new BoltzPay({});
    const tools = boltzpayTools(sdk);
    expect(tools.boltzpay_fetch).toBeDefined();
  });

  it("accepts a BoltzPayConfig object", () => {
    const tools = boltzpayTools({ budget: { daily: "10.00" } });
    expect(tools.boltzpay_budget).toBeDefined();
  });
});

describe("tool shapes", () => {
  const tools = boltzpayTools();

  for (const key of TOOL_KEYS) {
    it(`${key} has description, inputSchema, and execute`, () => {
      const t = tools[key];
      expect(t).toHaveProperty("description");
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(10);
      expect(t).toHaveProperty("execute");
      expect(typeof t.execute).toBe("function");
      // AI SDK v6 tools expose inputSchema (not v5 "parameters")
      expect(t).toHaveProperty("inputSchema");
    });
  }
});

const MOCK_DISCOVERED: DiscoveredEntry[] = [
  {
    name: "Test API — Price",
    url: "https://test-api.example.com/price",
    protocol: "x402",
    category: "crypto-data",
    description: "Test price endpoint",
    pricing: "$0.01",
    live: {
      status: "live",
      livePrice: "$0.01",
      protocol: "x402",
      network: "base-sepolia",
    },
  },
  {
    name: "Test API — Signal",
    url: "https://test-api.example.com/signal",
    protocol: "x402",
    category: "crypto-data",
    description: "Test signal endpoint",
    pricing: "$0.05",
    live: { status: "offline", reason: "Timeout" },
  },
];

describe("boltzpay_discover", () => {
  it("returns live-probed entries with no filter", async () => {
    const sdk = new BoltzPay({});
    vi.spyOn(sdk, "discover").mockResolvedValueOnce(MOCK_DISCOVERED);
    const tools = boltzpayTools(sdk);
    const result = await tools.boltzpay_discover.execute(
      {},
      { toolCallId: "test-1", messages: [], abortSignal: undefined as never },
    );
    expect(result.count).toBe(2);
    expect(result.entries).toBeInstanceOf(Array);
    expect(result.categories).toBeInstanceOf(Array);
    expect(result.entries[0]).toHaveProperty("name");
    expect(result.entries[0]).toHaveProperty("url");
    expect(result.entries[0]).toHaveProperty("protocol");
    expect(result.entries[0]).toHaveProperty("category");
    expect(result.entries[0]).toHaveProperty("status");
    expect(result.entries[0]).toHaveProperty("price");
    expect(result.entries[0]).toHaveProperty("isPriceVerified");
    expect(result.entries[0].status).toBe("live");
    expect(result.entries[0].isPriceVerified).toBe(true);
    expect(result.entries[1].status).toBe("offline");
    expect(result.entries[1].isPriceVerified).toBe(false);
  });

  it("passes category and enableLiveDiscovery to sdk.discover", async () => {
    const sdk = new BoltzPay({});
    const spy = vi
      .spyOn(sdk, "discover")
      .mockResolvedValueOnce([MOCK_DISCOVERED[0]]);
    const tools = boltzpayTools(sdk);
    const result = await tools.boltzpay_discover.execute(
      { category: "crypto-data", enableLiveDiscovery: false },
      { toolCallId: "test-2", messages: [], abortSignal: undefined as never },
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "crypto-data",
        enableLiveDiscovery: false,
      }),
    );
    expect(result.count).toBe(1);
    for (const entry of result.entries) {
      expect(entry.category).toBe("crypto-data");
    }
  });

  it("returns empty list for unknown category", async () => {
    const sdk = new BoltzPay({});
    vi.spyOn(sdk, "discover").mockResolvedValueOnce([]);
    const tools = boltzpayTools(sdk);
    const result = await tools.boltzpay_discover.execute(
      { category: "nonexistent" },
      { toolCallId: "test-3", messages: [], abortSignal: undefined as never },
    );
    expect(result.count).toBe(0);
    expect(result.entries).toEqual([]);
    expect(result.message).toContain("nonexistent");
  });
});

describe("boltzpay_history", () => {
  it("returns empty payment history initially", async () => {
    const tools = boltzpayTools();
    const result = await tools.boltzpay_history.execute(
      {},
      { toolCallId: "test-4", messages: [], abortSignal: undefined as never },
    );
    expect(result.count).toBe(0);
    expect(result.payments).toEqual([]);
  });
});

describe("boltzpay_budget", () => {
  it("returns budget state with 'get' action", async () => {
    const tools = boltzpayTools({ budget: { daily: "10.00" } });
    const result = await tools.boltzpay_budget.execute(
      { action: "get" },
      { toolCallId: "test-5", messages: [], abortSignal: undefined as never },
    );
    expect(result).toHaveProperty("dailyLimit");
    expect(result).toHaveProperty("dailySpent");
    expect(result).toHaveProperty("dailyRemaining");
    expect(result.dailyLimit).toBe("$10.00");
    expect(result.dailySpent).toBe("$0.00");
  });

  it("returns guidance for 'set' action", async () => {
    const tools = boltzpayTools();
    const result = await tools.boltzpay_budget.execute(
      { action: "set" },
      { toolCallId: "test-6", messages: [], abortSignal: undefined as never },
    );
    expect(result).toHaveProperty("error");
    expect(result).toHaveProperty("guidance");
  });
});

describe("boltzpay_check", () => {
  it("returns isPaid false for a non-402 URL", async () => {
    const sdk = new BoltzPay({});
    // Mock quote to throw (simulating non-402 endpoint)
    vi.spyOn(sdk, "quote").mockRejectedValueOnce(
      new ProtocolError("protocol_detection_failed", "No protocol"),
    );
    const tools = boltzpayTools(sdk);
    const result = await tools.boltzpay_check.execute(
      { url: "https://example.com" },
      { toolCallId: "test-7", messages: [], abortSignal: undefined as never },
    );
    expect(result.isPaid).toBe(false);
  });
});

describe("boltzpay_wallet", () => {
  it("returns capabilities without credentials", async () => {
    const tools = boltzpayTools();
    const result = await tools.boltzpay_wallet.execute(
      {},
      { toolCallId: "test-8", messages: [], abortSignal: undefined as never },
    );
    expect(result).toHaveProperty("network");
    expect(result).toHaveProperty("protocols");
    expect(result).toHaveProperty("canPay");
    expect(result).toHaveProperty("chains");
    expect(result.canPay).toBe(false);
    expect(result.protocols).toContain("x402");
  });
});
