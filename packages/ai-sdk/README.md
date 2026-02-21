# @boltzpay/ai-sdk

Vercel AI SDK tools for BoltzPay — give your AI agent a `fetch()` that pays automatically via x402 and L402 protocols.

## Install

```bash
npm install @boltzpay/ai-sdk ai @boltzpay/sdk
```

## Quick Start

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { boltzpayTools } from "@boltzpay/ai-sdk";

const { text } = await generateText({
  model: openai("gpt-4.1"),
  tools: boltzpayTools(),
  maxSteps: 5,
  prompt: "Discover available paid APIs and check prices",
});
```

## Full Example (with Coinbase credentials)

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { boltzpayTools } from "@boltzpay/ai-sdk";

const { text } = await generateText({
  model: openai("gpt-4.1"),
  tools: boltzpayTools({
    coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
    coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
    coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
    budget: { daily: "5.00", perTransaction: "1.00" },
  }),
  maxSteps: 5,
  prompt: "Fetch the latest crypto data from https://invy.bot/api",
});

console.log(text);
```

## Tools Reference

| Tool | Description | Requires Credentials |
|------|-------------|---------------------|
| `boltzpay_fetch` | Fetch data from a paid API. Auto-detects protocol, pays, returns response. | Yes |
| `boltzpay_check` | Check if a URL requires payment. Returns protocol and price. | No |
| `boltzpay_quote` | Get a detailed price quote with multi-chain options. | No |
| `boltzpay_discover` | Browse the directory of compatible paid APIs. | No |
| `boltzpay_budget` | View current budget limits and spending. | No |
| `boltzpay_history` | View payment history for this session. | No |
| `boltzpay_wallet` | View wallet info, chains, and balances. | No |

## Configuration

### Without credentials (read-only mode)

Discover, check, and quote tools work without any credentials:

```ts
const tools = boltzpayTools();
```

### With Coinbase credentials (full payment mode)

```ts
const tools = boltzpayTools({
  coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
  coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
  coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
  budget: { daily: "10.00" },
});
```

### With pre-built SDK instance

```ts
import { BoltzPay } from "@boltzpay/sdk";

const sdk = new BoltzPay({ /* config */ });
const tools = boltzpayTools(sdk);
```

## Protocols & Chains

- **x402** — HTTP 402 payment protocol (Base, Solana)
- **L402** — Lightning Network payment protocol by Lightning Labs

## Links

- [BoltzPay GitHub](https://github.com/leventilo/boltzpay)
- [BoltzPay SDK](https://www.npmjs.com/package/@boltzpay/sdk)
- [Vercel AI SDK](https://ai-sdk.dev)

## License

MIT
