import type { BoltzPay } from "@boltzpay/sdk";
import { Money } from "@boltzpay/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHistory } from "../../src/tools/history.js";
import { createMockSdk, createTestClient } from "../helpers.js";

describe("boltzpay_history", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let sdk: BoltzPay;

  beforeEach(async () => {
    sdk = createMockSdk();
    const result = await createTestClient((server) => {
      registerHistory(server, sdk);
    });
    client = result.client;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return formatted payment records with chain info", async () => {
    const timestamp = new Date("2026-02-18T10:00:00Z");
    vi.mocked(sdk.getHistory).mockReturnValue([
      {
        id: "pay-1",
        url: "https://api.example.com/data",
        protocol: "x402",
        amount: Money.fromCents(100n),
        timestamp,
        txHash: `0x${"a".repeat(64)}`,
        network: "eip155:8453",
      },
      {
        id: "pay-2",
        url: "https://api.example.com/news",
        protocol: "l402",
        amount: Money.fromCents(50n),
        timestamp,
        txHash: undefined,
        network: undefined,
      },
    ]);

    const result = await client.callTool({
      name: "boltzpay_history",
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].url).toBe("https://api.example.com/data");
    expect(parsed[0].protocol).toBe("x402");
    expect(parsed[0].amount).toBe("$1.00");
    expect(parsed[0].txHash).toBe(`0x${"a".repeat(64)}`);
    expect(parsed[0].chain).toBe("Base");
    expect(parsed[0].network).toBe("eip155:8453");
    expect(parsed[1].txHash).toBeNull();
    expect(parsed[1].chain).toBe("\u2014");
    expect(parsed[1].network).toBeNull();
  });

  it("should return no payments message when history is empty", async () => {
    vi.mocked(sdk.getHistory).mockReturnValue([]);

    const result = await client.callTool({
      name: "boltzpay_history",
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("No payments");
  });
});
