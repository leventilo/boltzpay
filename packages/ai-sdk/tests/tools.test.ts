import { BoltzPay, type DiscoveredEntry } from "@boltzpay/sdk";
import { describe, expect, it, vi } from "vitest";
import { boltzpayTools } from "../src/index";

const TOOL_KEYS = [
  "boltzpay_fetch",
  "boltzpay_diagnose",
  "boltzpay_quote",
  "boltzpay_discover",
  "boltzpay_budget",
  "boltzpay_history",
  "boltzpay_wallet",
] as const;

// AI SDK v6 ToolExecutionOptions requires abortSignal: AbortSignal, but it is
// unused in unit tests. This helper provides the required shape with a single
// justified cast, avoiding repetition across every test call site.
function testContext(id: string) {
  return { toolCallId: id, messages: [], abortSignal: undefined as never };
}

describe("boltzpayTools factory", () => {
  it("returns an object with all 7 tool keys", () => {
    const tools = boltzpayTools();
    for (const key of TOOL_KEYS) {
      expect(tools).toHaveProperty(key);
    }
    expect(Object.keys(tools)).toHaveLength(7);
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
    slug: "test-api-price",
    name: "Test API — Price",
    url: "https://test-api.example.com/price",
    protocol: "x402",
    score: 85,
    health: "healthy",
    category: "crypto-data",
    isPaid: true,
    badge: "established",
  },
  {
    slug: "test-api-signal",
    name: "Test API — Signal",
    url: "https://test-api.example.com/signal",
    protocol: "x402",
    score: 55,
    health: "degraded",
    category: "crypto-data",
    isPaid: true,
    badge: null,
  },
];

describe("boltzpay_discover", () => {
  it("returns registry entries with no filter", async () => {
    const sdk = new BoltzPay({});
    vi.spyOn(sdk, "discover").mockResolvedValueOnce(MOCK_DISCOVERED);
    const tools = boltzpayTools(sdk);
    const result = await tools.boltzpay_discover.execute(
      {},
      testContext("test-1"),
    );
    expect(result.count).toBe(2);
    expect(result.entries).toBeInstanceOf(Array);
    expect(result.entries[0]).toHaveProperty("name");
    expect(result.entries[0]).toHaveProperty("url");
    expect(result.entries[0]).toHaveProperty("protocol");
    expect(result.entries[0]).toHaveProperty("category");
    expect(result.entries[0]).toHaveProperty("score");
    expect(result.entries[0]).toHaveProperty("health");
    expect(result.entries[0].score).toBe(85);
    expect(result.entries[0].health).toBe("healthy");
    expect(result.entries[1].health).toBe("degraded");
  });

  it("passes category and protocol to sdk.discover", async () => {
    const sdk = new BoltzPay({});
    const spy = vi
      .spyOn(sdk, "discover")
      .mockResolvedValueOnce([MOCK_DISCOVERED[0]]);
    const tools = boltzpayTools(sdk);
    const result = await tools.boltzpay_discover.execute(
      { category: "crypto-data", protocol: "x402" },
      testContext("test-2"),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "crypto-data",
        protocol: "x402",
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
      testContext("test-3"),
    );
    expect(result.count).toBe(0);
    expect(result.entries).toEqual([]);
    expect(result.message).toContain("No APIs found");
  });
});

describe("boltzpay_history", () => {
  it("returns empty payment history initially", async () => {
    const tools = boltzpayTools();
    const result = await tools.boltzpay_history.execute(
      {},
      testContext("test-4"),
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
      testContext("test-5"),
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
      testContext("test-6"),
    );
    expect(result).toHaveProperty("error");
    expect(result).toHaveProperty("guidance");
  });
});

describe("boltzpay_wallet", () => {
  it("returns capabilities without credentials", async () => {
    const tools = boltzpayTools();
    const result = await tools.boltzpay_wallet.execute(
      {},
      testContext("test-8"),
    );
    expect(result).toHaveProperty("network");
    expect(result).toHaveProperty("protocols");
    expect(result).toHaveProperty("canPay");
    expect(result).toHaveProperty("chains");
    expect(result.canPay).toBe(false);
    expect(result.protocols).toContain("x402");
  });
});
