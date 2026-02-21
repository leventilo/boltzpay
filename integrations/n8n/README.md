# @boltzpay/n8n-nodes-boltzpay

n8n community node for BoltzPay -- pay for API data in your workflows.

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

## Credentials

Some operations (like `fetch`) require Coinbase CDP credentials to sign payment transactions.

1. In n8n, go to **Credentials > New**
2. Search for **BoltzPay**
3. Enter your Coinbase CDP credentials:
   - **API Key ID** -- Your Coinbase CDP API Key ID
   - **API Key Secret** -- Your Coinbase CDP API Key Secret
   - **Wallet Secret** -- Your Coinbase CDP Wallet Secret

Get your keys from the [Coinbase Developer Platform](https://portal.cdp.coinbase.com/).

> **Note:** The `check`, `quote`, and `discover` operations work **without credentials**. You only need credentials for the `fetch` operation which executes payments.

## Operations

| Operation    | Description                        | Requires Credentials |
| ------------ | ---------------------------------- | -------------------- |
| **Fetch**    | Fetch and pay for API data         | Yes                  |
| **Check**    | Check if URL requires payment      | No                   |
| **Quote**    | Get price quote for URL            | No                   |
| **Discover** | Browse compatible API directory    | No                   |

### Fetch

Fetches data from a paid API endpoint. Handles payment negotiation automatically via x402/L402 protocols.

**Parameters:**
- **URL** -- The API endpoint URL
- **HTTP Method** -- GET, POST, or PUT (default: GET)
- **Chain** -- Auto, EVM (Base), or SVM (Solana) (default: Auto)

**Output:**
```json
{
  "status": 200,
  "body": "{\"data\": \"...\"}",
  "payment": {
    "protocol": "x402",
    "amount": "$0.05",
    "url": "https://invy.bot/api",
    "txHash": "0x..."
  }
}
```

### Check

Checks whether a URL requires payment. Useful for conditional workflow logic.

**Output (paid endpoint):**
```json
{
  "isPaid": true,
  "protocol": "x402",
  "amount": "$0.05",
  "network": "eip155:8453"
}
```

**Output (free endpoint):**
```json
{
  "isPaid": false
}
```

### Quote

Gets the price quote for a URL without executing payment.

**Output:**
```json
{
  "protocol": "x402",
  "amount": "$0.25",
  "network": "eip155:8453",
  "allAccepts": [
    { "network": "eip155:8453", "amount": 25 },
    { "network": "solana:...", "amount": 25 }
  ]
}
```

### Discover

Browses the built-in API directory of compatible paid endpoints. Optionally filter by category.

**Categories:** `crypto-data`, `utilities`, `demo`

**Output:** One item per directory entry with `name`, `url`, `protocol`, `category`, `description`, `pricing`.

## Usage Examples

### Check Before You Pay

A workflow that checks if a URL requires payment before fetching:

1. **Manual Trigger** -- Start the workflow
2. **BoltzPay (Check)** -- Check `https://invy.bot/api`
3. **IF** -- Branch on `isPaid === true`
4. **BoltzPay (Fetch)** -- Fetch and pay for the data (true branch)
5. **HTTP Request** -- Use standard HTTP for free endpoints (false branch)

### API Discovery

A workflow to browse available paid APIs:

1. **Manual Trigger** -- Start the workflow
2. **BoltzPay (Discover)** -- List all APIs (or filter by category `crypto-data`)
3. **Filter** -- Select APIs matching your criteria
4. **BoltzPay (Quote)** -- Get live pricing for each API

## Supported Protocols

- **x402** -- HTTP 402-based payment protocol (EVM: Base, Solana)
- **L402** -- Lightning Network payment protocol (Bitcoin)

## Links

- [BoltzPay GitHub](https://github.com/leventilo/boltzpay)
- [BoltzPay npm](https://www.npmjs.com/package/@boltzpay/sdk)
- [boltzpay.ai](https://boltzpay.ai)
- [x402.org](https://x402.org)

## License

MIT
