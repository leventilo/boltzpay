import { BoltzPay, ProtocolError } from "@boltzpay/sdk";
import { describe, expect, it, vi } from "vitest";
import { boltzpayTools } from "../src/index";

const TOOL_KEYS = [
  "boltzpay_fetch",
  "boltzpay_check",
  "boltzpay_quote",
  "boltzpay_discover",
  "boltzpay_budget",
  "boltzpay_history",
  "boltzpay_wallet",
] as const;

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

describe("boltzpay_discover", () => {
  it("returns directory entries with no filter", async () => {
    const tools = boltzpayTools();
    const result = await tools.boltzpay_discover.execute(
      {},
      { toolCallId: "test-1", messages: [], abortSignal: undefined as never },
    );
    expect(result.count).toBeGreaterThan(0);
    expect(result.entries).toBeInstanceOf(Array);
    expect(result.categories).toBeInstanceOf(Array);
    expect(result.entries[0]).toHaveProperty("name");
    expect(result.entries[0]).toHaveProperty("url");
    expect(result.entries[0]).toHaveProperty("protocol");
    expect(result.entries[0]).toHaveProperty("category");
    expect(result.entries[0]).toHaveProperty("pricing");
  });

  it("filters by category", async () => {
    const tools = boltzpayTools();
    const result = await tools.boltzpay_discover.execute(
      { category: "crypto-data" },
      { toolCallId: "test-2", messages: [], abortSignal: undefined as never },
    );
    expect(result.count).toBeGreaterThan(0);
    for (const entry of result.entries) {
      expect(entry.category).toBe("crypto-data");
    }
  });

  it("returns empty list for unknown category", async () => {
    const tools = boltzpayTools();
    const result = await tools.boltzpay_discover.execute(
      { category: "nonexistent" },
      { toolCallId: "test-3", messages: [], abortSignal: undefined as never },
    );
    expect(result.count).toBe(0);
    expect(result.entries).toEqual([]);
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
