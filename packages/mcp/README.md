[![npm](https://img.shields.io/npm/v/@boltzpay/mcp)](https://www.npmjs.com/package/@boltzpay/mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

# @boltzpay/mcp

MCP server for BoltzPay — gives Claude Desktop and any MCP client the ability to discover, quote, and pay APIs across three protocols. 7 tools, zero code.

## Quick Start

```bash
npx @boltzpay/mcp
```

Add to Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "boltzpay": {
      "command": "npx",
      "args": ["-y", "@boltzpay/mcp"],
      "env": {
        "COINBASE_API_KEY_ID": "your-key-id",
        "COINBASE_API_KEY_SECRET": "your-key-secret",
        "COINBASE_WALLET_SECRET": "your-wallet-secret"
      }
    }
  }
}
```

Omit the `env` block to run in **explore-only mode** — discover, quote, diagnose, and wallet all work without credentials.

## Multi-Protocol

BoltzPay auto-detects the payment protocol for every endpoint:

| Protocol | Payment | Detection |
|----------|---------|-----------|
| **x402** | USDC on Base (EVM) | `402` + `X-PAYMENT` header |
| **L402** | Lightning Network (sats) | `402` + `WWW-Authenticate: L402` |
| **MPP** | Stripe, Tempo, Visa (fiat) | `402` + `X-MPP` or payment link |

No configuration needed — the SDK probes the endpoint and routes to the correct adapter.

## Tools

| Tool | Description | Requires Keys |
|------|-------------|:-------------:|
| `boltzpay_fetch` | Fetch a paid API endpoint. Auto-detects protocol, pays, returns response body + payment metadata. | Yes |
| `boltzpay_quote` | Check the price of an endpoint without paying. Returns protocol, amount, currency, and chain alternatives. | No |
| `boltzpay_discover` | Search the BoltzPay registry for paid APIs. Filter by category, protocol, score, or free-text query. | No |
| `boltzpay_budget` | View spending limits, amount spent, and remaining balance (daily, monthly, per-transaction). | No |
| `boltzpay_history` | List payments made during the current session with URLs, amounts, protocols, chains, and timestamps. | No |
| `boltzpay_wallet` | Check wallet connectivity, configured credentials, account addresses, balances, and budget. | No |
| `boltzpay_diagnose` | Full endpoint diagnostic — DNS, protocol detection (x402/L402/MPP), format version, pricing, multi-chain support, health, and latency. | No |

### boltzpay_discover

Backed by the live [BoltzPay registry](https://status.boltzpay.ai) (6,900+ endpoints, 400+ providers), not a static directory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | `string?` | Filter by category |
| `protocol` | `string?` | Filter by protocol: `x402`, `l402`, or `mpp` |
| `minScore` | `number?` | Minimum trust score (0-100, EWMA-weighted) |
| `query` | `string?` | Search by provider name or endpoint URL |

### boltzpay_diagnose

Probes a URL and returns a complete diagnostic report in one call:

- DNS resolution and HTTP status
- Protocol detection across all three protocols (x402, L402, MPP)
- Format version and payment scheme
- Pricing (per-chain when multi-chain)
- Health classification and latency breakdown

No payment credentials required.

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `COINBASE_API_KEY_ID` | For x402 | Coinbase CDP API key ID |
| `COINBASE_API_KEY_SECRET` | For x402 | Coinbase CDP API key secret |
| `COINBASE_WALLET_SECRET` | For x402 | Coinbase CDP wallet secret |
| `NWC_CONNECTION_STRING` | For L402 | Nostr Wallet Connect URI (Lightning payments) |
| `BOLTZPAY_NETWORK` | No | `base` (default) or `base-sepolia` (testnet) |
| `BOLTZPAY_DAILY_BUDGET` | No | Daily spending cap in USD (e.g. `5.00`) |
| `BOLTZPAY_MONTHLY_BUDGET` | No | Monthly spending cap in USD (e.g. `100.00`) |
| `BOLTZPAY_PER_TRANSACTION` | No | Max per-transaction amount in USD (e.g. `1.00`) |
| `BOLTZPAY_LOG_LEVEL` | No | `debug`, `info`, `warn`, `error`, or `silent` |

## Links

- [Documentation](https://docs.boltzpay.ai/guides/mcp-claude-desktop)
- [Registry](https://status.boltzpay.ai)
- [GitHub](https://github.com/leventilo/boltzpay)
- [SDK](https://www.npmjs.com/package/@boltzpay/sdk)
- [CLI](https://www.npmjs.com/package/@boltzpay/cli)

## Part of BoltzPay

This package is part of the [BoltzPay](https://github.com/leventilo/boltzpay) open-source SDK — giving AI agents the ability to discover and pay for APIs automatically across x402, L402, and MPP.

## License

MIT
