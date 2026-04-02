[![npm](https://img.shields.io/npm/v/@boltzpay/sdk)](https://www.npmjs.com/package/@boltzpay/sdk) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

# @boltzpay/sdk

A `fetch()` that pays — cross-protocol (x402, L402, MPP), multi-wallet, with registry discovery, streaming sessions, and MCP transport.

## Install

```bash
npm install @boltzpay/sdk
```

## Configuration

```ts
import { BoltzPay } from "@boltzpay/sdk";

const agent = new BoltzPay({
  wallets: [
    {
      type: "coinbase",
      name: "main",
      coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID!,
      coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET!,
      coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET!,
    },
    {
      type: "tempo",
      name: "mpp",
      tempoPrivateKey: process.env.TEMPO_PRIVATE_KEY!,
    },
  ],
  budget: { daily: "10.00", monthly: "100.00", perTransaction: "2.00" },
});
```

The `wallets` array accepts any combination of the five wallet types. The SDK routes each payment to the wallet matching the required protocol and network.

Legacy top-level credentials (`coinbaseApiKeyId`, etc.) are still supported for single-wallet setups.

## `fetch()`

Detects the payment protocol, negotiates the chain, pays, and returns the response. Works identically across x402, L402, and MPP endpoints.

```ts
const response = await agent.fetch("https://api.example.com/data");
const data = await response.json();
// response.payment contains { protocol, amount, network, txHash }
```

Options: `maxAmount`, `headers`, `method`, `body`, `chain`, `dryRun`.

## `discover()`

Queries the [BoltzPay Registry](https://status.boltzpay.ai) for paid API endpoints. Returns scored, health-checked entries across all indexed protocols.

```ts
const endpoints = await agent.discover({
  protocol: "x402",
  minScore: 70,
  category: "ai",
  query: "image generation",
  limit: 20,
});

for (const ep of endpoints) {
  console.log(`${ep.name} — ${ep.url} (score: ${ep.score}, ${ep.protocol})`);
}
```

Each `DiscoveredEntry` contains: `slug`, `name`, `url`, `protocol`, `score`, `health`, `category`, `isPaid`, `badge`.

Filters: `protocol`, `minScore`, `category`, `query`, `limit`, `offset`, `signal`.

## `openSession()`

Opens an MPP streaming session with a deposit. The session manages a payment channel — each `fetch()` inside the session is micro-paid via vouchers against the deposit. Unused funds are refunded on close.

```ts
const session = await agent.openSession("https://stream.example.com", { maxDeposit: "5.00" });
const res = await session.fetch("https://stream.example.com/query?q=hello");
const receipt = await session.close();
```

`SessionReceipt` shape:

```ts
interface SessionReceipt {
  readonly channelId: string;
  readonly totalSpent: bigint;    // USDC atomic units actually consumed
  readonly refunded: bigint;      // USDC atomic units returned from deposit
  readonly voucherCount: number;  // number of micro-payments issued
}
```

Requires a `tempo` wallet. The deposit is reserved from the budget at open and reconciled at close.

## `wrapMcpClient()`

Wraps a Model Context Protocol client to handle `-32042` payment-required errors transparently. The wrapped client intercepts payment challenges, pays via MPP, and returns the tool result with an attached receipt.

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const mcpClient = new Client({ name: "my-agent", version: "1.0.0" });
const wrapped = await agent.wrapMcpClient(mcpClient);
const result = await wrapped.callTool({ name: "search", arguments: { q: "test" } });
// result.receipt?: { method, status, reference, timestamp }
```

Requires at least one MPP wallet (`tempo` or `stripe-mpp`). Budget enforcement applies to every MCP payment.

## Budget Enforcement

Configure spending limits in the constructor:

```ts
const agent = new BoltzPay({
  wallets: [/* ... */],
  budget: {
    daily: "10.00",
    monthly: "100.00",
    perTransaction: "2.00",
    warningThreshold: 0.8,  // emits budget:warning at 80% usage (default)
  },
});
```

All limits are in USD. Limits apply uniformly to `fetch()`, `openSession()` (deposit reservation), and `wrapMcpClient()` payments.

Query budget state at any time:

```ts
const state = agent.getBudget();
// { dailySpent, monthlySpent, dailyLimit, monthlyLimit,
//   perTransactionLimit, dailyRemaining, monthlyRemaining }
```

Session deposits are reserved from the budget at open. Unused portions are released back on `session.close()`.

Events: `budget:warning` fires when spending crosses the threshold. `budget:exceeded` fires (and the transaction is rejected) when a limit would be breached.

## Wallet Types

The `wallets` array uses a discriminated union on the `type` field:

```ts
// Coinbase CDP — x402 payments (Base EVM, Solana SVM)
{ type: "coinbase", name: string, coinbaseApiKeyId: string,
  coinbaseApiKeySecret: string, coinbaseWalletSecret: string, networks?: string[] }

// Nostr Wallet Connect — L402 payments (Lightning Network)
{ type: "nwc", name: string, nwcConnectionString: string, networks?: string[] }

// Tempo — MPP payments (streaming sessions, MCP transport)
{ type: "tempo", name: string, tempoPrivateKey: string, networks?: string[] }

// Stripe MPP — MPP payments via Stripe
{ type: "stripe-mpp", name: string, stripeSecretKey: string, networks?: string[] }

// Visa MPP — MPP payments via Visa
{ type: "visa-mpp", name: string, visaJwe: string, networks?: string[] }
```

All wallet types accept an optional `networks` array to restrict which chain namespaces the wallet is used for.

## Events

Subscribe via `agent.on(event, callback)`. Unsubscribe via `agent.off(event, callback)`.

| Event | Payload | When |
|-------|---------|------|
| `payment` | `PaymentRecord` | Payment completed successfully |
| `budget:warning` | `{ spent, limit, period, usage }` | Spending crosses warning threshold |
| `budget:exceeded` | `{ requested, limit, period }` | Transaction rejected by budget |
| `retry:attempt` | `{ attempt, maxRetries, delay, phase, error }` | Transient failure, retrying |
| `retry:exhausted` | `{ maxRetries, phase, error }` | All retries failed |
| `payment:uncertain` | `{ url, amount, protocol, error, nonce?, txHash? }` | Payment sent but delivery uncertain |
| `protocol:unsupported-scheme` | `{ scheme, maxAmount?, network?, url }` | Endpoint requires unsupported payment scheme |
| `protocol:unsupported-network` | `{ namespace, url }` | Endpoint requires unsupported network |
| `wallet:selected` | `{ walletName, network, reason }` | Wallet chosen for a payment |
| `session:open` | `{ channelId, depositAmount, url }` | MPP session opened |
| `session:voucher` | `{ channelId, cumulativeAmount, index }` | Micro-payment voucher issued in session |
| `session:close` | `{ channelId, totalSpent, refunded }` | MPP session closed |
| `session:error` | `{ channelId?, error }` | Session-level error |
| `mcp:payment` | `{ toolName, amount, receipt }` | MCP tool call paid via MPP |
| `error` | `Error` | Unrecoverable error |

## Key Methods

| Method | Description | Requires Wallet |
|--------|-------------|:---------------:|
| `fetch(url, options?)` | Fetch a paid API — auto-detect protocol, pay, return response | Yes |
| `quote(url)` | Get price quote without paying | No |
| `discover(options?)` | Query BoltzPay Registry for paid endpoints | No |
| `openSession(url, options?)` | Open an MPP streaming session with deposit | Yes (tempo) |
| `wrapMcpClient(client)` | Wrap MCP client for automatic -32042 payment | Yes (tempo/stripe-mpp) |
| `getBudget()` | Current spending state and remaining limits | No |
| `getHistory()` | All payment records (persistent if storage enabled) | No |
| `getCapabilities()` | Network, protocols, chains, wallet info | No |
| `getWalletStatus()` | Comprehensive wallet health check | No |
| `getBalances()` | Query USDC balance per chain | No |
| `diagnose(url)` | Deep endpoint health check (DNS, HTTP, headers, protocol) | No |
| `close()` | Close all connections (NWC WebSocket, etc.) | No |
| `on(event, cb)` | Subscribe to events | No |
| `off(event, cb)` | Unsubscribe from events | No |

## Links

- [Documentation](https://docs.boltzpay.ai)
- [Registry](https://status.boltzpay.ai) — 6,900+ endpoints, 400+ providers, 3 protocols
- [GitHub](https://github.com/leventilo/boltzpay)
- [MCP Server](https://www.npmjs.com/package/@boltzpay/mcp) — for Claude Desktop
- [CLI](https://www.npmjs.com/package/@boltzpay/cli) — terminal and Python bridge
- [Vercel AI SDK tools](https://www.npmjs.com/package/@boltzpay/ai-sdk)

## Part of BoltzPay

This package is part of the [BoltzPay](https://github.com/leventilo/boltzpay) open-source SDK — giving AI agents the ability to pay for APIs automatically across x402, L402, and MPP.

## License

MIT
