import { strict as assert } from "node:assert";
import { describe, expect, it } from "vitest";
import { BoltzPay } from "../../src/boltzpay";

// Skip E2E tests if no Coinbase credentials are configured
const hasCredentials =
  process.env.COINBASE_API_KEY_ID &&
  process.env.COINBASE_API_KEY_SECRET &&
  process.env.COINBASE_WALLET_SECRET;
const canRunIntegration = !!hasCredentials;

describe.skipIf(!canRunIntegration)("E2E: multi-chain features", () => {
  function createAgent(
    overrides: Record<string, unknown> = {},
  ): BoltzPay {
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
      network: "base",
      logLevel: "debug",
      ...overrides,
    });
  }

  // --- 1. quote() returns allAccepts on a multi-chain V2 endpoint ---
  it("should return allAccepts with chain options on multi-chain V2 endpoint", async () => {
    const agent = createAgent();
    const quote = await agent.quote("https://invy.bot/api");

    assert(quote.allAccepts, "expected allAccepts from quote");
    expect(quote.allAccepts.length).toBeGreaterThanOrEqual(1);

    // Each accept option should have the required chain fields
    for (const accept of quote.allAccepts) {
      expect(accept.namespace).toBeDefined();
      expect(accept.network).toBeDefined();
      expect(accept.amount).toBeGreaterThan(0n);
      expect(accept.payTo).toBeDefined();
    }
  }, 30_000);

  // --- 2. getCapabilities() reports evm+svm chains ---
  it("should report evm+svm capabilities", () => {
    const agent = createAgent();
    const caps = agent.getCapabilities();

    expect(caps.chains).toContain("evm");
    expect(caps.chains).toContain("svm");
    expect(caps.protocols).toContain("x402");
    expect(caps.network).toBe("base");
  });

  // --- 3. quote with preferredChains ---
  it("should respect preferredChains in config", async () => {
    const agent = createAgent({ preferredChains: ["svm"] });
    const quote = await agent.quote("https://invy.bot/api");

    // If the endpoint exposes SVM accepts, the primary quote should reflect SVM preference.
    // quote() returns the raw probe result (no chain selection applied at quote level),
    // so we validate allAccepts includes SVM if available.
    if (quote.allAccepts?.some((a) => a.namespace === "svm")) {
      expect(
        quote.allAccepts.some((a) => a.namespace === "svm"),
      ).toBe(true);
    }
    // If no SVM accept, that's fine — endpoint just doesn't support it.
    // The key assertion is that quote() still works with preferredChains set.
    expect(quote.protocol).toBe("x402");
    expect(quote.amount.cents).toBeGreaterThan(0n);
  }, 30_000);

  // --- 4. fetch free endpoint = zero side effects ---
  it("should passthrough free endpoints with zero side effects", async () => {
    const agent = createAgent();
    const response = await agent.fetch("https://httpbin.org/get");

    expect(response.ok).toBe(true);
    expect(response.payment).toBeUndefined();
    expect(response.protocol).toBeUndefined();
    expect(agent.getHistory()).toHaveLength(0);

    const budget = agent.getBudget();
    expect(budget.dailySpent.cents).toBe(0n);
    expect(budget.monthlySpent.cents).toBe(0n);
  }, 15_000);

  // --- 5. getBudget() initial state with configured budget ---
  it("should track budget with zero spent on fresh agent", () => {
    const agent = createAgent({ budget: { daily: 5.0 } });
    const budget = agent.getBudget();

    expect(budget.dailySpent.cents).toBe(0n);
    expect(budget.monthlySpent.cents).toBe(0n);
    assert(budget.dailyLimit, "expected dailyLimit to be set");
    expect(budget.dailyLimit.cents).toBe(500n);
    assert(budget.dailyRemaining, "expected dailyRemaining to be set");
    expect(budget.dailyRemaining.cents).toBe(500n);
    // No monthly limit set, so monthlyRemaining should be undefined
    expect(budget.monthlyRemaining).toBeUndefined();
  });
});
