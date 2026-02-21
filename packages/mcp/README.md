[![npm](https://img.shields.io/npm/v/@boltzpay/mcp)](https://www.npmjs.com/package/@boltzpay/mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

# @boltzpay/mcp

MCP server for BoltzPay — add paid API access to Claude Desktop and other MCP clients. 7 tools, zero code.

## Quick Start

```bash
npx @boltzpay/mcp
```

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

Omit the `env` block to run in **explore-only mode** (quote, check, discover work without keys).

## Features

- **7 MCP tools** — fetch, quote, check, discover, budget, history, wallet
- **Zero code** — Run with `npx`, configure via environment variables
- **Explore mode** — Discover and quote APIs without credentials
- **Budget enforcement** — Daily spending limits via `BOLTZPAY_DAILY_BUDGET`
- **Multi-protocol** — x402 (USDC) and L402 (Lightning) auto-detection

## Tools

| Tool | Description | Requires Keys |
|------|-------------|:-------------:|
| `boltzpay_fetch` | Fetch data from a paid API, auto-detect and pay | Yes |
| `boltzpay_quote` | Check price of an endpoint without paying | No |
| `boltzpay_check` | Detect if a URL requires payment | No |
| `boltzpay_discover` | Browse directory of compatible paid APIs | No |
| `boltzpay_budget` | View current spending budget status | No |
| `boltzpay_history` | List payments made during session | No |
| `boltzpay_wallet` | View wallet config, addresses, balances | No |

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `COINBASE_API_KEY_ID` | For payments | Coinbase CDP API key ID |
| `COINBASE_API_KEY_SECRET` | For payments | Coinbase CDP API key secret |
| `COINBASE_WALLET_SECRET` | For payments | Coinbase CDP wallet secret |
| `NWC_CONNECTION_STRING` | For L402 | NWC wallet connection string (Lightning) |
| `BOLTZPAY_NETWORK` | No | `base` (default) or `base-sepolia` |
| `BOLTZPAY_DAILY_BUDGET` | No | Daily spending limit (e.g. `5.00`) |

## Links

- [Documentation](https://docs.boltzpay.ai/guides/mcp-claude-desktop)
- [GitHub](https://github.com/leventilo/boltzpay)
- [SDK](https://www.npmjs.com/package/@boltzpay/sdk)
- [CLI](https://www.npmjs.com/package/@boltzpay/cli)

## Part of BoltzPay

This package is part of the [BoltzPay](https://github.com/leventilo/boltzpay) open-source SDK — giving AI agents the ability to pay for APIs automatically.

## License

MIT
