[![npm](https://img.shields.io/npm/v/@boltzpay/sdk)](https://www.npmjs.com/package/@boltzpay/sdk) [![CI](https://img.shields.io/github/actions/workflow/status/leventilo/boltzpay/ci.yml?branch=main)](https://github.com/leventilo/boltzpay/actions) [![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE) [![TypeScript](https://img.shields.io/badge/types-TypeScript-blue.svg)](https://www.typescriptlang.org/) [![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

# BoltzPay

> Give your AI agents a fetch() that pays. Multi-protocol (x402 + L402), multi-chain (Base + Solana), open source, your own keys.

BoltzPay detects whether an API endpoint requires payment, negotiates the best protocol and chain, pays with your credentials, and returns the data. One call. No vendor lock-in.

**[Docs](https://docs.boltzpay.ai)** · **[npm](https://www.npmjs.com/package/@boltzpay/sdk)** · **[GitHub](https://github.com/leventilo/boltzpay)**

## Install

```bash
npm install @boltzpay/sdk
```

## Quickstart

### Explore Mode (no keys required)

Discover paid APIs, check prices, and get quotes — no credentials needed.

```typescript
import { BoltzPay } from "@boltzpay/sdk";

const agent = new BoltzPay({});
const quote = await agent.quote("https://invy.bot/api");
console.log(quote.amount.toDisplayString(), quote.protocol); // "$0.05" "x402"
```

### Payment Mode

Add Coinbase CDP credentials to enable automatic payments.

```typescript
import { BoltzPay } from "@boltzpay/sdk";

const agent = new BoltzPay({
  coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
  coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
  coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
});

const response = await agent.fetch("https://invy.bot/api");
const data = await response.json();
```

## Why BoltzPay

- **Budget engine** — Daily, monthly, and per-transaction spending limits. Payment events and full spending history. No other x402 client gives you this level of control over what your agent spends.
- **MCP-ready** — Give Claude a payment wallet in 30 seconds with `npx @boltzpay/mcp`. 7 tools, zero code.
- **Protocol-agnostic** — x402, L402, and whatever comes next. Your code doesn't change when the ecosystem does.

## MCP Server (Claude Desktop)

Give Claude the ability to discover and pay for APIs.

**Step 1: Explore (no keys)**

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "boltzpay": {
      "command": "npx",
      "args": ["-y", "@boltzpay/mcp"]
    }
  }
}
```

Claude can now discover APIs, check prices, and get quotes — without any credentials.

**Step 2: Enable payments**

Add Coinbase credentials and a daily spending limit:

```json
{
  "mcpServers": {
    "boltzpay": {
      "command": "npx",
      "args": ["-y", "@boltzpay/mcp"],
      "env": {
        "COINBASE_API_KEY_ID": "your-key-id",
        "COINBASE_API_KEY_SECRET": "your-key-secret",
        "COINBASE_WALLET_SECRET": "your-wallet-secret",
        "BOLTZPAY_DAILY_BUDGET": "5.00"
      }
    }
  }
}
```

**7 MCP tools available:** `fetch` (pay and retrieve), `quote` (check cost), `check` (detect payment requirement), `budget` (show remaining budget), `history` (list recent payments), `discover` (browse compatible APIs), `wallet` (show addresses and balances).

## Budget & Safety

Control what your agent spends. Budget enforcement is built into the SDK — not an afterthought.

```typescript
const agent = new BoltzPay({
  coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
  coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
  coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
  budget: {
    daily: "$5.00",
    perTransaction: "$0.50",
  },
});

// Payments that exceed limits are blocked automatically
agent.on("budget:exceeded", (event) => {
  console.log(`Blocked: ${event.period} budget exceeded`);
});

// Track every payment
agent.on("payment", (event) => {
  console.log(`Paid ${event.amount.toDisplayString()} via ${event.protocol} for ${event.url}`);
});

// Check remaining budget anytime
const budget = agent.getBudget();
// { dailySpent: Money, dailyLimit: Money, dailyRemaining: Money, ... }
```

## Protocols

| Protocol | Backed by       | Payment            | Detection            | Status |
| -------- | --------------- | ------------------ | -------------------- | ------ |
| x402     | Coinbase        | USDC on-chain      | 402 status + headers | Live   |
| L402     | Lightning Labs  | Bitcoin (Lightning) | 402 + L402 header    | Live   |

The SDK auto-detects which protocol an endpoint uses and handles payment accordingly. x402 works with Coinbase CDP credentials. L402 requires an `nwcConnectionString` in the config (a Nostr Wallet Connect URI from [Coinos](https://coinos.io), [Primal](https://primal.net), or any [NWC-compatible wallet](https://nwc.dev)).

## Multi-Chain

BoltzPay supports EVM (Base mainnet and Base Sepolia testnet) and SVM (Solana) when endpoints accept those chains. Most current endpoints use EVM. When a server accepts multiple chains, the SDK auto-negotiates the best option based on your wallet balances and network conditions.

Override chain selection with the `preferredChains` config option:

```typescript
const agent = new BoltzPay({
  coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
  coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
  coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
  preferredChains: ["evm"],
});
```

## CLI

```bash
npx @boltzpay/cli <command>
```

**Check if an endpoint requires payment:**

```bash
boltzpay check https://invy.bot/api
# Protocol: x402 | Price: $0.05 | Chain: Base
```

**Fetch and pay:**

```bash
boltzpay fetch https://invy.bot/api --json
# {"data": {"holdings": [...]}, "payment": {"amount": "$0.05", "protocol": "x402"}}
```

**Browse compatible APIs:**

```bash
boltzpay discover
# 25 endpoints across 5 categories: Crypto Data, Utilities, Demo, Research, Dev Tools
```

**Interactive demo:**

```bash
boltzpay demo
# Walks you through wallet check, endpoint selection, quote, and optional fetch
```

**Show wallet info:**

```bash
boltzpay wallet
# EVM: 0x1a2b...3c4d (Base) | SVM: 5e6f...7g8h (Solana)
```

## Examples

### Test Server

Local x402 server for testing payments on Base Sepolia testnet — all public testnet endpoints are currently broken due to a [known Next.js middleware bug](https://github.com/coinbase/x402/issues/644).

```bash
# Terminal 1 — start the test server
cd examples/test-server && npm install && npm start

# Terminal 2 — pay with BoltzPay
boltzpay check http://localhost:4021/api/joke
boltzpay fetch http://localhost:4021/api/joke
```

See [examples/test-server/README.md](examples/test-server/README.md) for prerequisites and details.

## Compatible APIs

BoltzPay works with any x402 or L402 endpoint. The built-in directory includes 25 verified endpoints (23 x402 + 2 L402) across categories: `crypto-data`, `utilities`, `demo`, `research`, and `dev-tools`.

Browse the directory programmatically:

```typescript
import { API_DIRECTORY, getDirectoryCategories } from "@boltzpay/sdk";

console.log(getDirectoryCategories()); // ["crypto-data", "utilities", "demo", "research", "dev-tools"]
console.log(API_DIRECTORY.length);     // 25
```

Or via CLI: `boltzpay discover`

## Packages

| Package | Description |
| ------- | ----------- |
| [@boltzpay/sdk](https://www.npmjs.com/package/@boltzpay/sdk) | Main SDK — `BoltzPay` class with fetch, quote, budget, events |
| [@boltzpay/core](https://www.npmjs.com/package/@boltzpay/core) | Domain types, Money value object, error hierarchy |
| [@boltzpay/protocols](https://www.npmjs.com/package/@boltzpay/protocols) | Protocol adapters (x402, L402) and wallet management |
| [@boltzpay/mcp](https://www.npmjs.com/package/@boltzpay/mcp) | MCP server for Claude Desktop |
| [@boltzpay/cli](https://www.npmjs.com/package/@boltzpay/cli) | Command-line interface and Python bridge |
| [@boltzpay/ai-sdk](https://www.npmjs.com/package/@boltzpay/ai-sdk) | Vercel AI SDK tools (7 tools) |

## Framework Integrations

BoltzPay works with major AI agent frameworks — TypeScript and Python.

### Vercel AI SDK

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

```bash
npm install @boltzpay/ai-sdk ai @boltzpay/sdk
```

### LangChain (Python)

```python
from langchain_boltzpay import BoltzPayFetchTool, BoltzPayDiscoverTool

tools = [BoltzPayDiscoverTool(), BoltzPayFetchTool()]
# Use with any LangChain agent — tools call @boltzpay/cli via subprocess
```

```bash
pip install langchain-boltzpay
```

Requires Node.js 20+ (the CLI bridge calls `npx @boltzpay/cli` under the hood).

### CrewAI (Python)

Works natively via MCP — no Python package needed:

```python
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

server_params = StdioServerParameters(
    command="npx", args=["-y", "@boltzpay/mcp"],
)

with MCPServerAdapter(server_params) as tools:
    agent = Agent(role="Researcher", tools=tools)
```

Or use the CLI bridge tools: `pip install boltzpay-crewai`

### n8n

Install `@boltzpay/n8n-nodes-boltzpay` via **Settings > Community Nodes** in n8n. 4 operations: Fetch, Check, Quote, Discover.

### OpenClaw

BoltzPay is available as an [OpenClaw](https://github.com/openclaw/openclaw) skill for ClawHub-compatible agents. See [`integrations/openclaw/`](integrations/openclaw/).

## Roadmap

- **AP2 support** — Google's Agent Payments Protocol (tracking spec stabilization)

## Troubleshooting

**Detection fails behind corporate/coworking WiFi**
Some network proxies intercept HTTP 402 responses or strip payment headers, which prevents x402 detection. If `check` or `quote` returns unexpected results, try on a direct connection. Use `--debug` to inspect raw headers.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and PR guidelines.

## License

MIT — see [LICENSE](LICENSE)

---

Created by [@leventilo](https://github.com/leventilo)
