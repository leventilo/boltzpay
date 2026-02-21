[![npm](https://img.shields.io/npm/v/@boltzpay/n8n-nodes-boltzpay)](https://www.npmjs.com/package/@boltzpay/n8n-nodes-boltzpay) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# @boltzpay/n8n-nodes-boltzpay

n8n community node for BoltzPay — pay for API data directly in your workflows via x402 and L402 protocols.

## Installation

### Via n8n Community Nodes (recommended)

1. In n8n, go to **Settings > Community Nodes**
2. Click **Install**
3. Enter `@boltzpay/n8n-nodes-boltzpay`
4. Click **Install**

### Via npm

```bash
npm install @boltzpay/n8n-nodes-boltzpay
```

## Features

- **4 operations** — Fetch, Check, Quote, Discover
- **Credential management** — Native n8n credential type for Coinbase CDP keys
- **Explore without keys** — Check, Quote, and Discover work without credentials
- **Multi-protocol** — x402 (USDC on Base/Solana) and L402 (Lightning)

## Credentials

Some operations (like Fetch) require Coinbase CDP credentials to sign payment transactions.

1. In n8n, go to **Credentials > New**
2. Search for **BoltzPay**
3. Enter your Coinbase CDP credentials:
   - **API Key ID** — Your Coinbase CDP API Key ID
   - **API Key Secret** — Your Coinbase CDP API Key Secret
   - **Wallet Secret** — Your Coinbase CDP Wallet Secret

Get your keys from the [Coinbase Developer Platform](https://portal.cdp.coinbase.com/).

> **Note:** The `Check`, `Quote`, and `Discover` operations work **without credentials**. You only need credentials for the `Fetch` operation which executes payments.

## Operations

| Operation    | Description                     | Requires Credentials |
| ------------ | ------------------------------- | :------------------: |
| **Fetch**    | Fetch and pay for API data      | Yes                  |
| **Check**    | Check if URL requires payment   | No                   |
| **Quote**    | Get price quote for URL         | No                   |
| **Discover** | Browse compatible API directory | No                   |

### Fetch

Fetches data from a paid API endpoint. Handles payment negotiation automatically.

**Parameters:**
- **URL** — The API endpoint URL
- **HTTP Method** — GET, POST, or PUT (default: GET)
- **Chain** — Auto, EVM (Base), or SVM (Solana) (default: Auto)

### Check

Checks whether a URL requires payment. Useful for conditional workflow logic.

### Quote

Gets the price quote for a URL without executing payment.

### Discover

Browses the built-in API directory of compatible paid endpoints. Optionally filter by category.

**Categories:** `crypto-data`, `utilities`, `demo`

## Usage Examples

### Check Before You Pay

1. **Manual Trigger** — Start the workflow
2. **BoltzPay (Check)** — Check `https://invy.bot/api`
3. **IF** — Branch on `isPaid === true`
4. **BoltzPay (Fetch)** — Fetch and pay for the data (true branch)
5. **HTTP Request** — Use standard HTTP for free endpoints (false branch)

### API Discovery

1. **Manual Trigger** — Start the workflow
2. **BoltzPay (Discover)** — List all APIs (or filter by category)
3. **Filter** — Select APIs matching your criteria
4. **BoltzPay (Quote)** — Get live pricing for each API

## Links

- [GitHub](https://github.com/leventilo/boltzpay)
- [SDK](https://www.npmjs.com/package/@boltzpay/sdk)
- [boltzpay.ai](https://boltzpay.ai)
- [x402.org](https://x402.org)

## Part of BoltzPay

This package is part of the [BoltzPay](https://github.com/leventilo/boltzpay) open-source SDK — giving AI agents the ability to pay for APIs automatically.

## License

MIT
