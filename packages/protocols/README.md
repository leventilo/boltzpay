# @boltzpay/protocols

Protocol adapters and wallet managers for the BoltzPay SDK — x402, L402, and MPP implementations.

## Install

```bash
npm install @boltzpay/protocols
```

> Most users should install `@boltzpay/sdk` instead. This package is useful if you need direct access to protocol adapters, wallet managers, or conversion utilities.

## Protocol Adapters

### X402Adapter

Handles the [x402 protocol](https://www.x402.org/) — HTTP 402 payments with USDC on Base (EVM) and Solana (SVM).

```ts
import { X402Adapter } from "@boltzpay/protocols";
```

### L402Adapter

Handles the [L402 protocol](https://docs.lightning.engineering/the-lightning-network/l402) — Lightning Network payments with macaroon-based credentials.

```ts
import { L402Adapter } from "@boltzpay/protocols";
```

### MppAdapter

Handles the [MPP protocol](https://datatracker.ietf.org/doc/draft-nottingham-http-micropayments/) (IETF track) — supports Stripe, Tempo, Visa, and Lightning payment methods. Implements `ProtocolAdapter` for single-charge payments. For streaming sessions, use `MppSessionManager`.

```ts
import { MppAdapter } from "@boltzpay/protocols";
```

## ProtocolRouter

Auto-detects which protocol a server uses by probing all adapters in parallel, then routes to the correct one.

```ts
import { ProtocolRouter } from "@boltzpay/protocols";
```

## MppMethodSelector

Selects the best MPP payment method based on configured wallets and preference strategy.

```ts
import { MppMethodSelector } from "@boltzpay/protocols";
```

## MppSessionManager

Manages MPP streaming sessions — open, send vouchers, and close.

```ts
import { MppSessionManager } from "@boltzpay/protocols";
```

## Wallet Managers

- **`CdpWalletManager`** — Coinbase Developer Platform wallet (EVM + Solana)
- **`CdpManager`** — CDP account provisioning and management
- **`NwcWalletManager`** — Nostr Wallet Connect for Lightning payments
- **`CdpSvmSigner`** — Solana transaction signer via CDP

## Utilities

- **`centsToUsdcAtomic(cents)`** — Convert USD cents to USDC atomic units
- **`usdcAtomicToCents(atomic)`** — Convert USDC atomic units to USD cents

## Peer Dependencies

- **`mppx`** — Required for MPP protocol support (optional)
- **`viem`** — Required for EVM transaction handling (optional)

## License

MIT
