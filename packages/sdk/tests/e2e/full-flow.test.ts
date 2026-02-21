import { strict as assert } from "node:assert";
import { describe, expect, it, vi } from "vitest";
import { BoltzPay } from "../../src/boltzpay";
import { BudgetExceededError } from "../../src/errors/budget-exceeded-error";
import type { PaymentRecord } from "../../src/history/types";

// Skip E2E tests if no credentials or endpoint configured
const hasCredentials =
  process.env.COINBASE_API_KEY_ID &&
  process.env.COINBASE_API_KEY_SECRET &&
  process.env.COINBASE_WALLET_SECRET;
const testEndpoint = process.env.TEST_X402_ENDPOINT;
const canRunIntegration = hasCredentials && testEndpoint;

describe.skipIf(!canRunIntegration)("E2E: full BoltzPay flow", () => {
  function createAgent(overrides: Record<string, unknown> = {}): BoltzPay {
    const apiKeyId = process.env.COINBASE_API_KEY_ID;
    const apiKeySecret = process.env.COINBASE_API_KEY_SECRET;
    const walletSecret = process.env.COINBASE_WALLET_SECRET;
    assert(apiKeyId, "COINBASE_API_KEY_ID required");
    assert(apiKeySecret, "COINBASE_API_KEY_SECRET required");
    assert(walletSecret, "COINBASE_WALLET_SECRET required");
    return new BoltzPay({
      coinbaseApiKeyId: apiKeyId,
      coinbaseApiKeySecret: apiKeySecret,
      coinbaseWalletSecret: walletSecret,
      network: "base-sepolia",
      logLevel: "debug",
      ...overrides,
    });
  }

  it("creates instance, fetches x402 endpoint, returns paid data", async () => {
    const agent = createAgent();
    assert(testEndpoint, "TEST_X402_ENDPOINT required");

    // Register event listeners
    const payments: PaymentRecord[] = [];
    agent.on("payment", (record) => payments.push(record));

    // Fetch from x402 endpoint
    const response = await agent.fetch(testEndpoint);

    // Verify response wrapper
    expect(response.ok).toBe(true);
    expect(response.payment).not.toBeNull();
    expect(response.protocol).toBe("x402");

    // Verify payment details
    expect(response.payment?.protocol).toBe("x402");
    expect(response.payment?.amount.cents).toBeGreaterThan(0n);
    expect(response.payment?.txHash).toBeDefined();
    expect(response.payment?.txHash).toMatch(/^0x[0-9a-fA-F]+$/);

    // Verify data is accessible
    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);

    // Verify payment event fired
    expect(payments).toHaveLength(1);
    const firstPayment = payments[0];
    assert(firstPayment, "expected payment event");
    expect(firstPayment.protocol).toBe("x402");
    expect(firstPayment.txHash).toBeDefined();
    expect(firstPayment.url).toBe(testEndpoint);

    // Verify history
    const history = agent.getHistory();
    expect(history).toHaveLength(1);
    const firstHistory = history[0];
    assert(firstHistory, "expected history entry");
    expect(firstHistory.url).toBe(testEndpoint);

    // Verify budget tracking (no budget = unlimited, but spent should reflect)
    const budget = agent.getBudget();
    expect(budget.dailySpent.cents).toBeGreaterThan(0n);
    expect(budget.monthlySpent.cents).toBeGreaterThan(0n);
    // No limits set, so remaining should be undefined
    expect(budget.dailyRemaining).toBeUndefined();
    expect(budget.monthlyRemaining).toBeUndefined();
  }, 90_000);

  it("fetches free endpoint with zero overhead", async () => {
    const agent = createAgent();

    // Fetch a known free endpoint
    const response = await agent.fetch("https://httpbin.org/json");

    expect(response.ok).toBe(true);
    expect(response.payment).toBeUndefined();
    expect(response.protocol).toBeUndefined();

    const data = await response.json<Record<string, unknown>>();
    expect(data).toBeDefined();
    expect(typeof data).toBe("object");

    // No history for free endpoints
    expect(agent.getHistory()).toHaveLength(0);

    // No budget impact
    const budget = agent.getBudget();
    expect(budget.dailySpent.cents).toBe(0n);
  }, 15_000);

  it("blocks payment when budget per-transaction limit is exceeded", async () => {
    assert(testEndpoint, "TEST_X402_ENDPOINT required");

    // Set a very low per-transaction limit (0.001 cents = $0.00001)
    const agent = createAgent({
      budget: { perTransaction: 0.00001 },
    });

    const errorListener = vi.fn();
    agent.on("error", errorListener);

    // Quote should succeed (we need to know the price first)
    const quote = await agent.quote(testEndpoint);
    expect(quote.amount.cents).toBeGreaterThan(0n);

    // But fetch should throw BudgetExceededError since the price > $0.00001
    await expect(agent.fetch(testEndpoint)).rejects.toThrow(
      BudgetExceededError,
    );

    // History should be empty (payment was blocked)
    expect(agent.getHistory()).toHaveLength(0);

    // Error event should have fired
    expect(errorListener).toHaveBeenCalled();
  }, 30_000);
});
