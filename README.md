[![npm](https://img.shields.io/npm/v/@boltzpay/sdk)](https://www.npmjs.com/package/@boltzpay/sdk) [![CI](https://img.shields.io/github/actions/workflow/status/leventilo/boltzpay/ci.yml?branch=main)](https://github.com/leventilo/boltzpay/actions) [![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE) [![TypeScript](https://img.shields.io/badge/types-TypeScript-blue.svg)](https://www.typescriptlang.org/) [![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

# BoltzPay

> A `fetch()` that pays. x402, L402, MPP — auto-detected, multi-chain, open source.

BoltzPay detects payment protocols, negotiates the best chain, pays, and returns data. One call. No vendor lock-in.

**[Docs](https://docs.boltzpay.ai)** · **[Registry](https://status.boltzpay.ai)** · **[npm](https://www.npmjs.com/package/@boltzpay/sdk)** · **[GitHub](https://github.com/leventilo/boltzpay)**

```typescript
import { BoltzPay } from "@boltzpay/sdk";

const agent = new BoltzPay({
  wallets: [
    { type: "coinbase", name: "main", coinbaseApiKeyId: "...", coinbaseApiKeySecret: "...", coinbaseWalletSecret: "..." },
  ],
  budget: { daily: "5.00" },
});

const response = await agent.fetch(url);
// x402, L402, MPP — protocol auto-detected, payment handled
```

## Discover

Browse 6,900+ scored endpoints from the [BoltzPay Registry](https://status.boltzpay.ai):

```typescript
const apis = await agent.discover({ protocol: "mpp", minScore: 80 });
```

## Protocols

| Protocol | Payment | Wallet |
|----------|---------|--------|
| x402 | USDC on-chain (Base, Solana) | Coinbase CDP |
| L402 | Bitcoin Lightning | NWC |
| MPP | Stripe, Tempo, Visa | Multi-wallet |

The SDK auto-detects which protocol an endpoint uses. Configure one or more wallets — the router tries each until one succeeds.

## Sessions

MPP streaming sessions with deposit, pay-per-chunk, and clean close:

```typescript
const session = await agent.openSession(url);
const res = await session.fetch(url);
const receipt = await session.close(); // { totalSpent, refunded, voucherCount }
```

## MCP

Wrap any MCP client with automatic payment handling (`-32042`):

```typescript
const wrapped = await agent.wrapMcpClient(mcpClient);
const result = await wrapped.callTool({ name: "paid-tool" });
// Budget enforced, receipt returned
```

Or give Claude Desktop a payment wallet — zero code:

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

## Budget & Safety

```typescript
agent.on("budget:exceeded", (e) => console.log(`Blocked: ${e.period}`));
agent.on("payment", (e) => console.log(`${e.amount.toDisplayString()} via ${e.protocol}`));

const budget = agent.getBudget();
// { dailySpent, monthlySpent, dailyLimit, monthlyLimit,
//   perTransactionLimit, dailyRemaining, monthlyRemaining }
```

Daily, monthly, per-transaction limits. Session deposit reservations. Allowlist/blocklist. Max amount guard.

## CLI

<!-- TODO: Re-record CLI GIF with `discover` (registry) instead of `directory` -->

```bash
npx @boltzpay/cli discover --protocol mpp --min-score 70
npx @boltzpay/cli fetch https://api.example.com
npx @boltzpay/cli diagnose https://api.example.com
npx @boltzpay/cli quote https://api.example.com
```

## Packages

| Package | Description |
|---------|-------------|
| [@boltzpay/sdk](https://www.npmjs.com/package/@boltzpay/sdk) | SDK — fetch, discover, sessions, budget, events |
| [@boltzpay/core](https://www.npmjs.com/package/@boltzpay/core) | Domain types, Money VO, protocol interfaces |
| [@boltzpay/protocols](https://www.npmjs.com/package/@boltzpay/protocols) | Protocol adapters (x402, L402, MPP) |
| [@boltzpay/mcp](https://www.npmjs.com/package/@boltzpay/mcp) | MCP server — 7 tools for Claude Desktop |
| [@boltzpay/cli](https://www.npmjs.com/package/@boltzpay/cli) | CLI — terminal + Python bridge |
| [@boltzpay/ai-sdk](https://www.npmjs.com/package/@boltzpay/ai-sdk) | Vercel AI SDK tools |

## Integrations

- **LangChain**: `pip install langchain-boltzpay` — [docs](https://docs.boltzpay.ai)
- **CrewAI**: `pip install boltzpay-crewai` — [docs](https://docs.boltzpay.ai)
- **n8n**: `@boltzpay/n8n-nodes-boltzpay` — [docs](https://docs.boltzpay.ai)
- **OpenClaw**: see [`integrations/openclaw/`](integrations/openclaw/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and PR guidelines.

## License

MIT — see [LICENSE](LICENSE)

---

Created by [@leventilo](https://github.com/leventilo)

## 💰 Bounty Contribution

- **Task:** aibtc.news classifieds placement — boltzpay exposure to autonomous-agent operato
- **Reward:** $402
- **Source:** GitHub-Paid
- **Date:** 2026-04-27

