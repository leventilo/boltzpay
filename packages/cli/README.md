[![npm](https://img.shields.io/npm/v/@boltzpay/cli)](https://www.npmjs.com/package/@boltzpay/cli) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)

# @boltzpay/cli

CLI for BoltzPay — fetch paid APIs from your terminal. Also serves as the Python bridge for LangChain and CrewAI integrations.

## Install

```bash
npm install -g @boltzpay/cli
```

Or run directly:

```bash
npx @boltzpay/cli fetch https://invy.bot/api
```

## Quick Start

```bash
# Explore APIs (no keys needed)
boltzpay discover
boltzpay check https://invy.bot/api
boltzpay quote https://invy.bot/api

# Fetch and pay (requires Coinbase CDP keys)
export COINBASE_API_KEY_ID="your-key-id"
export COINBASE_API_KEY_SECRET="your-key-secret"
export COINBASE_WALLET_SECRET="your-wallet-secret"

boltzpay fetch https://invy.bot/api
```

## Features

- **8 commands** — fetch, quote, check, discover, budget, history, wallet, demo
- **JSON output** — `--json` flag for scripting and automation
- **Python bridge** — LangChain and CrewAI integrations use `npx @boltzpay/cli` under the hood
- **Interactive demo** — `boltzpay demo` walks through wallet, discovery, quote, and fetch
- **Multi-protocol** — x402 (USDC) and L402 (Lightning) auto-detection

## Commands

| Command | Description | Requires Keys |
|---------|-------------|:-------------:|
| `boltzpay fetch <url>` | Fetch a paid API endpoint | Yes |
| `boltzpay quote <url>` | Get price quote | No |
| `boltzpay check <url>` | Check if URL requires payment | No |
| `boltzpay discover` | Browse API directory | No |
| `boltzpay budget` | Show budget status | No |
| `boltzpay history` | Show payment history | No |
| `boltzpay wallet` | Show wallet info and balances | No |
| `boltzpay demo` | Interactive demo walkthrough | No |

## Global Flags

- `--json` — Output as JSON (for scripting and Python bridge)
- `--verbose` — Show additional details
- `--debug` — Show debug information (headers, timing)

## Python Bridge

The CLI serves as a bridge for Python frameworks. The LangChain and CrewAI integrations call `npx @boltzpay/cli <command> --json` under the hood.

```bash
pip install langchain-boltzpay  # LangChain integration
pip install boltzpay-crewai     # CrewAI integration
```

## Links

- [Documentation](https://docs.boltzpay.ai/guides/cli)
- [GitHub](https://github.com/leventilo/boltzpay)
- [SDK](https://www.npmjs.com/package/@boltzpay/sdk)
- [MCP Server](https://www.npmjs.com/package/@boltzpay/mcp) — for Claude Desktop

## Part of BoltzPay

This package is part of the [BoltzPay](https://github.com/leventilo/boltzpay) open-source SDK — giving AI agents the ability to pay for APIs automatically.

## License

MIT
