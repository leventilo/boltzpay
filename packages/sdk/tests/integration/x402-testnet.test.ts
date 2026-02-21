import { strict as assert } from "node:assert";
import { describe, expect, it } from "vitest";
import { BoltzPay } from "../../src/boltzpay";
import type { PaymentRecord } from "../../src/history/types";

// Skip integration tests if no credentials or endpoint configured
const hasCredentials =
  process.env.COINBASE_API_KEY_ID &&
  process.env.COINBASE_API_KEY_SECRET &&
  process.env.COINBASE_WALLET_SECRET;
const testEndpoint = process.env.TEST_X402_ENDPOINT;
const canRunIntegration = hasCredentials && testEndpoint;

describe.skipIf(!canRunIntegration)(
  "x402 testnet payment on Base Sepolia",
  () => {
    function createAgent(): BoltzPay {
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
      });
    }

    it("should fetch an x402 endpoint and complete payment", async () => {
      const agent = createAgent();
      assert(testEndpoint, "TEST_X402_ENDPOINT required");

      // Track payment events
      const payments: PaymentRecord[] = [];
      agent.on("payment", (record) => payments.push(record));

      // Perform the actual x402 payment on testnet
      const response = await agent.fetch(testEndpoint);

      // Verify response wrapper
      expect(response.ok).toBe(true);
      expect(response.payment).not.toBeNull();
      expect(response.payment?.protocol).toBe("x402");
      expect(response.payment?.amount.cents).toBeGreaterThan(0n);

      // Verify txHash is a valid hex string (EVM transaction hash)
      expect(response.payment?.txHash).toBeDefined();
      expect(response.payment?.txHash).toMatch(/^0x[0-9a-fA-F]+$/);

      // Verify protocol detection
      expect(response.protocol).toBe("x402");

      // Verify payment event was emitted
      expect(payments).toHaveLength(1);
      const firstPayment = payments[0];
      assert(firstPayment, "expected payment event");
      expect(firstPayment.protocol).toBe("x402");
      expect(firstPayment.txHash).toBeDefined();
      expect(firstPayment.url).toBe(testEndpoint);

      // Verify history tracking
      const history = agent.getHistory();
      expect(history).toHaveLength(1);
      const firstHistory = history[0];
      assert(firstHistory, "expected history entry");
      expect(firstHistory.protocol).toBe("x402");
      expect(firstHistory.url).toBe(testEndpoint);

      // Verify response data is accessible
      // The response should contain actual content from the x402 endpoint
      const text = await response.text();
      expect(text.length).toBeGreaterThan(0);
    }, 60_000);

    it("should reflect payment in budget tracking", async () => {
      const agent = createAgent();
      assert(testEndpoint, "TEST_X402_ENDPOINT required");

      // Before any payment, budget should show zero spent
      const budgetBefore = agent.getBudget();
      expect(budgetBefore.dailySpent.cents).toBe(0n);
      expect(budgetBefore.monthlySpent.cents).toBe(0n);

      // Make payment
      await agent.fetch(testEndpoint);

      // After payment, budget should reflect the spend
      const budgetAfter = agent.getBudget();
      expect(budgetAfter.dailySpent.cents).toBeGreaterThan(0n);
      expect(budgetAfter.monthlySpent.cents).toBeGreaterThan(0n);
    }, 60_000);
  },
);
