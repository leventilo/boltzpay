import { strict as assert } from "node:assert";
import { describe, expect, it } from "vitest";
import { BoltzPay } from "../../src/boltzpay";
import { ProtocolError } from "../../src/errors/protocol-error";

// Skip integration tests if no credentials or endpoint configured
const hasCredentials =
  process.env.COINBASE_API_KEY_ID &&
  process.env.COINBASE_API_KEY_SECRET &&
  process.env.COINBASE_WALLET_SECRET;
const testEndpoint = process.env.TEST_X402_ENDPOINT;
const canRunIntegration = hasCredentials && testEndpoint;

describe.skipIf(!canRunIntegration)(
  "protocol detection on real endpoints",
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
      });
    }

    it("should detect x402 protocol on a known x402 endpoint", async () => {
      const agent = createAgent();
      assert(testEndpoint, "TEST_X402_ENDPOINT required");
      const quote = await agent.quote(testEndpoint);

      expect(quote.protocol).toBe("x402");
      expect(quote.amount.cents).toBeGreaterThan(0n);
      expect(quote.network).toBeDefined();
    }, 30_000);

    it("should not detect any protocol on a free endpoint", async () => {
      const agent = createAgent();

      // httpbin.org/get is a known free endpoint -- no payment protocol
      await expect(agent.quote("https://httpbin.org/get")).rejects.toThrow(
        ProtocolError,
      );

      // Verify the error has the correct code
      try {
        await agent.quote("https://httpbin.org/get");
      } catch (err) {
        expect(err).toBeInstanceOf(ProtocolError);
        expect((err as ProtocolError).code).toBe("protocol_detection_failed");
      }
    }, 15_000);

    it("should handle non-existent URL gracefully", async () => {
      const agent = createAgent();

      // Non-existent domain -- should fail gracefully (network error or detection failure)
      await expect(
        agent.quote("https://this-domain-does-not-exist-12345.example"),
      ).rejects.toThrow();
    }, 15_000);
  },
);
