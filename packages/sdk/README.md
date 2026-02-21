[![npm](https://img.shields.io/npm/v/@boltzpay/sdk)](https://www.npmjs.com/package/@boltzpay/sdk) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

# @boltzpay/sdk

Give your AI agents a `fetch()` that pays — multi-protocol (x402 + L402), multi-chain (Base + Solana), open source.

## Install

```bash
npm install @boltzpay/sdk
```

## Quick Start

```ts
import { BoltzPay } from "@boltzpay/sdk";

const agent = new BoltzPay({
  coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
  coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
  coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
  budget: { daily: "5.00", perTransaction: "1.00" },
});

const response = await agent.fetch("https://invy.bot/api");
const data = await response.json();
```

No credentials? Explore mode works too:

```ts
const agent = new BoltzPay({});
const quote = await agent.quote("https://invy.bot/api");
console.log(`${quote.protocol}: ${quote.amount.toDisplayString()}`);
```

## Features

- **`agent.fetch(url)`** — One call to detect protocol, negotiate chain, pay, and return data
- **Multi-protocol** — x402 (USDC on Base/Solana) and L402 (Lightning Network)
- **Budget engine** — Daily, monthly, and per-transaction spending limits
- **Payment events** — Subscribe to `payment`, `budget:warning`, `budget:exceeded`, `error`
- **Explore mode** — Quote, check, and discover APIs without credentials
- **API directory** — Built-in directory of 25+ verified paid endpoints
- **Persistent history** — Payment history saved to `~/.boltzpay/history.jsonl`

## Key Methods

| Method | Description | Requires Keys |
|--------|-------------|:-------------:|
| `fetch(url)` | Fetch a paid API, auto-detect protocol and pay | Yes |
| `quote(url)` | Get price quote without paying | No |
| `getBudget()` | View spending limits and remaining balance | No |
| `getHistory()` | List all payments (persistent if enabled) | No |
| `getCapabilities()` | View network, protocols, chains, wallet | No |
| `getWalletStatus()` | Comprehensive wallet health check | No |
| `getBalances()` | Query USDC balance per chain | No |
| `discover(options?)` | Browse and probe paid API directory | No |
| `close()` | Close connections (NWC WebSocket, etc.) | No |
| `on(event, cb)` | Subscribe to payment/budget/error events | No |

## Protocols

- **x402** — HTTP 402 payment protocol (Base EVM, Solana SVM)
- **L402** — Lightning Network payment protocol by Lightning Labs

## Links

- [Documentation](https://docs.boltzpay.ai)
- [GitHub](https://github.com/leventilo/boltzpay)
- [MCP Server](https://www.npmjs.com/package/@boltzpay/mcp) — for Claude Desktop
- [CLI](https://www.npmjs.com/package/@boltzpay/cli) — terminal and Python bridge
- [Vercel AI SDK tools](https://www.npmjs.com/package/@boltzpay/ai-sdk)

## Part of BoltzPay

This package is part of the [BoltzPay](https://github.com/leventilo/boltzpay) open-source SDK — giving AI agents the ability to pay for APIs automatically.

## License

MIT
