[![npm](https://img.shields.io/npm/v/@boltzpay/cli)](https://www.npmjs.com/package/@boltzpay/cli) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

# @boltzpay/cli

CLI for BoltzPay — fetch, diagnose, and discover paid APIs from your terminal. Supports x402, L402, and MPP protocols. Also serves as the Python bridge for LangChain and CrewAI integrations.

## Install

```bash
npm install -g @boltzpay/cli
```

Or run without installing:

```bash
npx @boltzpay/cli <command>
```

Requires Node.js >= 20.

## Quick Start

```bash
# Discover MPP endpoints with a trust score above 70
boltzpay discover --protocol mpp --min-score 70 --query weather

# Get a price quote (no keys needed)
boltzpay quote https://invy.bot/api

# Diagnose protocol, format, and health
boltzpay diagnose https://invy.bot/api

# Fetch and pay (requires wallet credentials)
export COINBASE_API_KEY_ID="your-key-id"
export COINBASE_API_KEY_SECRET="your-key-secret"
export COINBASE_WALLET_SECRET="your-wallet-secret"

boltzpay fetch https://invy.bot/api
```

## Commands

| Command | Description | Requires Keys |
|---------|-------------|:-------------:|
| `fetch <url>` | Fetch a paid API endpoint and pay automatically | Yes |
| `quote <url>` | Get price quote without paying | No |
| `diagnose <url>` | Diagnose endpoint — protocol, format, scheme, health | No |
| `discover` | Browse paid API endpoints from the BoltzPay registry | No |
| `budget` | Show remaining spending budget | No |
| `history` | Show payment history for this session | No |
| `wallet` | Show wallet status, connectivity, and configuration | No |
| `demo` | Interactive walkthrough of BoltzPay features | No |

### discover

Registry-backed discovery. Searches the BoltzPay trust registry (6,900+ endpoints, 400+ providers).

```bash
boltzpay discover                                    # List all endpoints
boltzpay discover --protocol mpp --min-score 70      # MPP endpoints, score >= 70
boltzpay discover --query weather                    # Search by name, URL, or description
boltzpay discover -c finance -p x402                 # x402 endpoints in finance category
```

| Flag | Description |
|------|-------------|
| `-p, --protocol <protocol>` | Filter by protocol: `x402`, `l402`, or `mpp` |
| `--min-score <score>` | Minimum trust score (0-100) |
| `-q, --query <query>` | Search by name, URL, or description |
| `-c, --category <category>` | Filter by category |

### fetch

```bash
boltzpay fetch https://api.example.com/data
boltzpay fetch https://api.example.com/data -m POST -d '{"q":"test"}'
boltzpay fetch https://api.example.com/data -H "Accept:application/json" -c evm
```

| Flag | Description |
|------|-------------|
| `-m, --method <method>` | HTTP method (default: GET) |
| `-H, --header <header...>` | HTTP headers as `key:value` |
| `-d, --data <body>` | Request body |
| `-c, --chain <chain>` | Override chain selection: `evm` or `svm` |

### demo

```bash
boltzpay demo              # Interactive walkthrough
boltzpay demo -y           # Skip payment confirmation
boltzpay demo --testnet    # Force testnet endpoint
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON (for scripting and Python bridge) |
| `--verbose` | Show additional details |
| `--debug` | Show debug information (headers, timing) |

## Python Bridge

The CLI serves as a bridge for Python frameworks. LangChain and CrewAI integrations call `npx @boltzpay/cli <command> --json` under the hood.

```bash
pip install langchain-boltzpay  # LangChain integration
pip install boltzpay-crewai     # CrewAI integration
```

## Links

- [Documentation](https://docs.boltzpay.ai/guides/cli)
- [BoltzPay Registry](https://status.boltzpay.ai)
- [GitHub](https://github.com/leventilo/boltzpay)
- [SDK](https://www.npmjs.com/package/@boltzpay/sdk)
- [MCP Server](https://www.npmjs.com/package/@boltzpay/mcp) — for Claude Desktop

## Part of BoltzPay

This package is part of the [BoltzPay](https://github.com/leventilo/boltzpay) open-source SDK — giving AI agents the ability to pay for APIs automatically.

## License

MIT
