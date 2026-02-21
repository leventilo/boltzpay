/**
 * Local x402 test server for integration/E2E tests.
 * Uses a mock facilitator that verifies payment headers but skips on-chain settlement.
 *
 * This validates the full SDK flow:
 * - 402 detection + payment-required header
 * - EIP-712 signing via CDP SDK
 * - Budget tracking and spending
 * - Response handling
 *
 * On-chain settlement is not tested here — that's @x402/evm code, not ours.
 * The mock facilitator returns success for settlement, which is sufficient to
 * validate our SDK's payment orchestration logic.
 *
 * Optional env:
 *   X402_TEST_PORT - Server port (default: 4402)
 */

import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const PORT = Number(process.env.X402_TEST_PORT ?? 4402);

// Generic burn address for tests — no real wallet association
const PAY_TO =
  process.env.X402_PAY_TO ?? "0x0000000000000000000000000000000000000001";

async function createServer(): Promise<{
  server: Server;
  port: number;
  url: string;
}> {
  const { paymentMiddleware, x402ResourceServer } = await import("@x402/hono");
  const { registerExactEvmScheme: registerServerScheme } = await import(
    "@x402/evm/exact/server"
  );

  const app = new Hono();

  // Mock facilitator: accepts all payments, skips on-chain settlement.
  // Validates the full SDK signing flow without needing ETH for gas.
  const mockFacilitator = {
    async verify() {
      return { isValid: true, payer: "0xmock" };
    },
    async settle(_payload: unknown, requirements: { network: string }) {
      return {
        success: true,
        transaction: `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 64)}`,
        network: requirements.network,
      };
    },
    async getSupported() {
      return {
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
        extensions: [],
        signers: {},
      };
    },
  };

  const resourceServer = new x402ResourceServer(mockFacilitator);
  registerServerScheme(resourceServer);

  app.use(
    "/paid",
    paymentMiddleware(
      {
        "GET /paid": {
          accepts: {
            scheme: "exact",
            price: "$0.001",
            network: "eip155:84532",
            payTo: PAY_TO,
          },
          description: "Test paid endpoint",
          mimeType: "application/json",
        },
      },
      resourceServer,
    ),
  );

  // Free endpoint (no paywall)
  app.get("/free", (c) => c.json({ status: "ok", paid: false }));

  // Paid endpoint (behind x402 paywall)
  app.get("/paid", (c) =>
    c.json({ status: "ok", paid: true, secret: "test-data-42" }),
  );

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: PORT }, () => {
      const url = `http://localhost:${PORT}`;
      console.log(`x402 test server running on ${url}`);
      console.log(`  GET /free  — no paywall`);
      console.log(`  GET /paid  — x402 paywall ($0.001 USDC, Base Sepolia)`);
      console.log(`  payTo: ${PAY_TO}`);
      console.log(`  Mode: MOCK facilitator (verify=ok, settle=mock)`);
      resolve({ server, port: PORT, url });
    });
  });
}

const isMain =
  process.argv[1]?.endsWith("x402-test-server.ts") ||
  process.argv[1]?.endsWith("x402-test-server.js");

if (isMain) {
  createServer().catch((e) => {
    console.error("Failed to start x402 test server:", e);
    process.exit(1);
  });
}

export { createServer };
