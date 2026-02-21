import type { BoltzPay } from "@boltzpay/sdk";
import { Money } from "@boltzpay/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBudget } from "../../src/tools/budget.js";
import { createMockSdk, createTestClient } from "../helpers.js";

describe("boltzpay_budget", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let sdk: BoltzPay;

  beforeEach(async () => {
    sdk = createMockSdk();
    const result = await createTestClient((server) => {
      registerBudget(server, sdk);
    });
    client = result.client;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return budget status with limits and spending", async () => {
    vi.mocked(sdk.getBudget).mockReturnValue({
      dailySpent: Money.fromCents(200n),
      monthlySpent: Money.fromCents(500n),
      dailyLimit: Money.fromCents(1000n),
      monthlyLimit: Money.fromCents(5000n),
      perTransactionLimit: Money.fromCents(100n),
      dailyRemaining: Money.fromCents(800n),
      monthlyRemaining: Money.fromCents(4500n),
    });

    const result = await client.callTool({
      name: "boltzpay_budget",
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.daily.limit).toBe("$10.00");
    expect(parsed.daily.spent).toBe("$2.00");
    expect(parsed.daily.remaining).toBe("$8.00");
    expect(parsed.monthly.limit).toBe("$50.00");
    expect(parsed.perTransaction.limit).toBe("$1.00");
  });

  it("should return no limits message when no budget configured", async () => {
    vi.mocked(sdk.getBudget).mockReturnValue({
      dailySpent: Money.zero(),
      monthlySpent: Money.zero(),
      dailyLimit: undefined,
      monthlyLimit: undefined,
      perTransactionLimit: undefined,
      dailyRemaining: undefined,
      monthlyRemaining: undefined,
    });

    const result = await client.callTool({
      name: "boltzpay_budget",
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("No budget limits");
  });
});
