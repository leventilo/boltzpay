// Local x402 test server for BoltzPay SDK
// Uses the official @x402/hono middleware + x402.org free testnet facilitator
//
// Usage:
//   cd examples/test-server && npm install && npm start
//
// Then test with BoltzPay:
//   npx @boltzpay/cli check http://localhost:4021/api/joke
//   npx @boltzpay/cli fetch http://localhost:4021/api/joke

import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

// x402.org provides a free testnet facilitator — no auth needed
const facilitator = new HTTPFacilitatorClient({
  url: "https://www.x402.org/facilitator",
});

// Any valid EVM address works as payTo (receives the test USDC)
const PAY_TO = "0x0000000000000000000000000000000000000001";

const app = new Hono();

const resourceServer = new x402ResourceServer(facilitator).register(
  "eip155:84532",
  new ExactEvmScheme(),
);

app.use(
  paymentMiddleware(
    {
      "GET /api/joke": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.001",
            network: "eip155:84532",
            payTo: PAY_TO,
          },
        ],
        description: "Get a programmer joke (testnet, $0.001 USDC)",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

const JOKES = [
  "Why do programmers prefer dark mode? Because light attracts bugs!",
  "A SQL query walks into a bar, sees two tables, and asks... 'Can I JOIN you?'",
  "There are only 10 types of people in the world: those who understand binary and those who don't.",
  "Why did the developer go broke? Because he used up all his cache.",
  "!false — it's funny because it's true.",
];

app.get("/api/joke", (c) => {
  const joke = JOKES[Math.floor(Math.random() * JOKES.length)];
  return c.json({ joke, paidWith: "x402", network: "base-sepolia" });
});

app.get("/health", (c) => c.json({ status: "ok" }));

const PORT = parseInt(process.env.PORT || "4021", 10);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║  BoltzPay Test Server (x402 on Base Sepolia)     ║
  ╠══════════════════════════════════════════════════╣
  ║                                                  ║
  ║  Paid:  GET /api/joke  ($0.001 testnet USDC)     ║
  ║  Free:  GET /health                              ║
  ║                                                  ║
  ║  http://localhost:${PORT}                          ║
  ║                                                  ║
  ╚══════════════════════════════════════════════════╝
  `);
});
