# @boltzpay/cli

CLI for BoltzPay -- fetch paid APIs from your terminal. Also serves as a Python bridge for LangChain and CrewAI integrations.

## Install

```bash
npm install -g @boltzpay/cli
```

Or run directly with npx:

```bash
npx @boltzpay/cli check https://invy.bot/api
```

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

## Usage

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

## Global Flags

- `--json` -- Output as JSON (for scripting and Python bridge)
- `--verbose` -- Show additional details
- `--debug` -- Show debug information (headers, timing)

## Python Bridge

The CLI serves as a bridge for Python frameworks. The LangChain and CrewAI integrations call `npx @boltzpay/cli <command> --json` under the hood.

```bash
pip install langchain-boltzpay  # LangChain integration
pip install boltzpay-crewai     # CrewAI integration
```

## Links

- [Full Documentation](https://docs.boltzpay.ai/guides/cli)
- [GitHub](https://github.com/leventilo/boltzpay)
- [SDK](https://www.npmjs.com/package/@boltzpay/sdk)
- [MCP Server](https://www.npmjs.com/package/@boltzpay/mcp) -- for Claude Desktop

## License

MIT
