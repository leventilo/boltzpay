# BoltzPay Test Server

Local x402 server for testing BoltzPay SDK payments on **Base Sepolia testnet**.

All public x402 testnet endpoints are currently broken due to a [known Next.js middleware bug](https://github.com/coinbase/x402/issues/644). This server uses Hono (not Next.js) and works correctly.

## Quick Start

```bash
# 1. Start the test server
cd examples/test-server
npm install
npm start

# 2. In another terminal — test with BoltzPay CLI
npx @boltzpay/cli check http://localhost:4021/api/joke
npx @boltzpay/cli fetch http://localhost:4021/api/joke
```

## Prerequisites

- [Coinbase Developer Platform](https://cdp.coinbase.com) API keys (for signing payments)
- Testnet USDC on Base Sepolia — get some from the [Circle faucet](https://faucet.circle.com/)

Set your keys in the project root `.env`:

```env
COINBASE_API_KEY_ID=your-key-id
COINBASE_API_KEY_SECRET=your-key-secret
COINBASE_WALLET_SECRET=your-wallet-secret
BOLTZPAY_NETWORK=base-sepolia
```

## How It Works

```
BoltzPay SDK                    Test Server                    x402.org Facilitator
     │                              │                                   │
     │── GET /api/joke ──────────▶  │                                   │
     │◀── 402 + PAYMENT-REQUIRED ── │                                   │
     │                              │                                   │
     │  (signs payment via CDP)     │                                   │
     │                              │                                   │
     │── GET + PAYMENT-SIGNATURE ─▶ │── POST /verify ────────────────▶  │
     │                              │◀── { isValid: true } ──────────── │
     │◀── 200 + joke ────────────── │                                   │
     │                              │── POST /settle ────────────────▶  │
     │                              │◀── { txHash: "0x..." } ───────── │
```

## Endpoints

| Path | Auth | Description |
|------|------|-------------|
| `GET /api/joke` | $0.001 USDC (testnet) | Returns a random programmer joke |
| `GET /health` | Free | Health check |

## Stack

- [Hono](https://hono.dev) — lightweight web framework
- [@x402/hono](https://www.npmjs.com/package/@x402/hono) — official x402 payment middleware
- [x402.org/facilitator](https://www.x402.org/facilitator) — free testnet facilitator (no auth)
