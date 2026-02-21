# @boltzpay/mcp

MCP server for BoltzPay -- add paid API access to Claude Desktop and other MCP clients.

## Setup (Claude Desktop)

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

- [Full Documentation](https://docs.boltzpay.ai/guides/mcp-claude-desktop)
- [GitHub](https://github.com/leventilo/boltzpay)
- [SDK](https://www.npmjs.com/package/@boltzpay/sdk)
- [CLI](https://www.npmjs.com/package/@boltzpay/cli)

## License

MIT
