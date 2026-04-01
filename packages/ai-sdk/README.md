[![npm](https://img.shields.io/npm/v/@boltzpay/ai-sdk)](https://www.npmjs.com/package/@boltzpay/ai-sdk) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

# @boltzpay/ai-sdk

Vercel AI SDK tools for BoltzPay -- 7 tools that give your AI agent the ability to discover, quote, and pay for APIs across x402, L402, and MPP.

## Install

```bash
npm install @boltzpay/ai-sdk ai @boltzpay/sdk
```

## Quick Start

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { boltzpayTools } from "@boltzpay/ai-sdk";

const { text } = await generateText({
  model: openai("gpt-4.1"),
  tools: boltzpayTools(),
  maxSteps: 5,
  prompt: "Discover paid APIs with a trust score above 80",
});
```

No credentials needed for discovery, quotes, and diagnostics.

## With Credentials

```ts
const { text } = await generateText({
  model: openai("gpt-4.1"),
  tools: boltzpayTools({
    coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
    coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
    coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
    budget: { daily: "5.00", perTransaction: "1.00" },
  }),
  maxSteps: 5,
  prompt: "Fetch the latest data from https://invy.bot/api",
});
```

### Multi-Wallet

v0.3 supports multiple wallet types via the `wallets` array. Mix crypto and traditional rails:

```ts
const tools = boltzpayTools({
  wallets: [
    {
      type: "coinbase",
      name: "main",
      coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID!,
      coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET!,
      coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET!,
    },
    {
      type: "stripe-mpp",
      name: "stripe",
      stripeSecretKey: process.env.STRIPE_SECRET_KEY!,
    },
  ],
  budget: { daily: "20.00", perTransaction: "2.00" },
});
```

Wallet types: `coinbase`, `nwc` (Lightning/NWC), `stripe-mpp`, `tempo`, `visa-mpp`.

## With Pre-built SDK Instance

```ts
import { BoltzPay } from "@boltzpay/sdk";

const sdk = new BoltzPay({ /* full config */ });
const tools = boltzpayTools(sdk);
```

## Tools

| Tool | Description | Credentials |
|------|-------------|:-----------:|
| `boltzpay_fetch` | Fetch from a paid API -- auto-detect protocol, pay, return response | Required |
| `boltzpay_quote` | Price quote with multi-chain options | -- |
| `boltzpay_discover` | Query the live BoltzPay registry (protocol, minScore, query filters) | -- |
| `boltzpay_budget` | Current budget limits and spend | -- |
| `boltzpay_history` | Payment history for this session | -- |
| `boltzpay_wallet` | Wallet info, chains, balances | -- |
| `boltzpay_diagnose` | Full endpoint diagnostic -- DNS, protocol detection, pricing, health, latency | -- |

### boltzpay_discover

Queries the [BoltzPay registry](https://status.boltzpay.ai) (6,900+ endpoints, 400+ providers). Accepts:

- `protocol` -- `"x402"`, `"l402"`, or `"mpp"`
- `minScore` -- minimum trust score (0--100, EWMA-based)
- `query` -- free-text search on endpoint name/URL
- `category` -- filter by category

## Protocols

| Protocol | Networks | Payment |
|----------|----------|---------|
| **x402** | Base, Solana | USDC on-chain via HTTP 402 |
| **L402** | Lightning | Sats via LSAT/L402 macaroon |
| **MPP** | Stripe, Tempo, Visa | Managed payment protocols (card rails, stablecoin, Visa Direct) |

## Links

- [Documentation](https://docs.boltzpay.ai)
- [Registry](https://status.boltzpay.ai)
- [GitHub](https://github.com/leventilo/boltzpay)
- [SDK](https://www.npmjs.com/package/@boltzpay/sdk)
- [Vercel AI SDK](https://ai-sdk.dev)

## Part of BoltzPay

This package is part of [BoltzPay](https://github.com/leventilo/boltzpay) -- the open-source SDK giving AI agents a `fetch()` that pays.

## License

MIT
