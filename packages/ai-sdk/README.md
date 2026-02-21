[![npm](https://img.shields.io/npm/v/@boltzpay/ai-sdk)](https://www.npmjs.com/package/@boltzpay/ai-sdk) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

# @boltzpay/ai-sdk

Vercel AI SDK tools for BoltzPay — 7 tools that give your AI agent the ability to discover, quote, and pay for APIs.

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
  prompt: "Discover available paid APIs and check prices",
});
```

## Features

- **7 AI tools** — fetch, quote, check, discover, budget, history, wallet
- **Drop-in integration** — Works with `generateText`, `streamText`, and agent loops
- **Explore mode** — Discover, check, and quote without credentials
- **Payment mode** — Pass Coinbase CDP credentials for automatic payments
- **Pre-built SDK instance** — Use your own `BoltzPay` instance for full control

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
  prompt: "Fetch the latest crypto data from https://invy.bot/api",
});
```

## With Pre-built SDK Instance

```ts
import { BoltzPay } from "@boltzpay/sdk";

const sdk = new BoltzPay({ /* config */ });
const tools = boltzpayTools(sdk);
```

## Tools Reference

| Tool | Description | Requires Credentials |
|------|-------------|:--------------------:|
| `boltzpay_fetch` | Fetch data from a paid API, auto-detect and pay | Yes |
| `boltzpay_check` | Check if a URL requires payment | No |
| `boltzpay_quote` | Get a detailed price quote with multi-chain options | No |
| `boltzpay_discover` | Browse the directory of compatible paid APIs | No |
| `boltzpay_budget` | View current budget limits and spending | No |
| `boltzpay_history` | View payment history for this session | No |
| `boltzpay_wallet` | View wallet info, chains, and balances | No |

## Protocols & Chains

- **x402** — HTTP 402 payment protocol (Base, Solana)
- **L402** — Lightning Network payment protocol by Lightning Labs

## Links

- [Documentation](https://docs.boltzpay.ai)
- [GitHub](https://github.com/leventilo/boltzpay)
- [SDK](https://www.npmjs.com/package/@boltzpay/sdk)
- [Vercel AI SDK](https://ai-sdk.dev)

## Part of BoltzPay

This package is part of the [BoltzPay](https://github.com/leventilo/boltzpay) open-source SDK — giving AI agents the ability to pay for APIs automatically.

## License

MIT
