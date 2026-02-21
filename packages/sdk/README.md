# @boltzpay/sdk

Give your AI agents a `fetch()` that pays -- multi-protocol (x402 + L402), multi-chain (Base + Solana), open source.

## Install

```bash
npm install @boltzpay/sdk
```

## Quick Start

```ts
import { BoltzPay } from "@boltzpay/sdk";

// Explore mode -- no credentials needed
const agent = new BoltzPay({});
const quote = await agent.quote("https://invy.bot/api");
console.log(`${quote.protocol}: ${quote.amount.toDisplayString()}`);
```

## With Payments

```ts
const agent = new BoltzPay({
  coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
  coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
  coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
  budget: { daily: "5.00", perTransaction: "1.00" },
});

const response = await agent.fetch("https://invy.bot/api");
const data = await response.json();

if (response.payment) {
  console.log(`Paid ${response.payment.amount.toDisplayString()}`);
}
```

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

## Events

- **`payment`** -- After successful payment
- **`budget:warning`** -- Spending crosses warning threshold
- **`budget:exceeded`** -- Transaction would exceed budget
- **`error`** -- Protocol or network errors

## Protocols

- **x402** -- HTTP 402 payment protocol (Base EVM, Solana SVM)
- **L402** -- Lightning Network payment protocol by Lightning Labs

## Links

- [Full Documentation](https://docs.boltzpay.ai)
- [GitHub](https://github.com/leventilo/boltzpay)
- [MCP Server](https://www.npmjs.com/package/@boltzpay/mcp) -- for Claude Desktop
- [CLI](https://www.npmjs.com/package/@boltzpay/cli) -- for terminal and Python bridge

## License

MIT
