# @boltzpay/protocols

Protocol adapters for the BoltzPay SDK -- x402 (HTTP 402) and L402 (Lightning) implementations.

## Install

```bash
npm install @boltzpay/protocols
```

> Most users should install `@boltzpay/sdk` instead. This package is useful if you need direct access to protocol adapters or wallet managers.

## Protocol Adapters

### x402 Adapter

Handles the [x402 protocol](https://www.x402.org/) -- HTTP 402 payments on Base (EVM) and Solana (SVM).

```ts
import { X402Adapter } from "@boltzpay/protocols";
```

### L402 Adapter

Handles the [L402 protocol](https://docs.lightning.engineering/the-lightning-network/l402) -- Lightning Network payments with macaroon-based credentials.

```ts
import { L402Adapter } from "@boltzpay/protocols";
```

### Protocol Router

Auto-detects which protocol a server uses and routes to the correct adapter.

```ts
import { ProtocolRouter } from "@boltzpay/protocols";
```

## Wallet Managers

- **`CdpWalletManager`** -- Coinbase Developer Platform wallet (EVM + Solana)
- **`NwcWalletManager`** -- Nostr Wallet Connect for Lightning payments
- **`CdpSvmSigner`** -- Solana transaction signer via CDP

## Utilities

- **`centsToUsdcAtomic(cents)`** -- Convert USD cents to USDC atomic units
- **`usdcAtomicToCents(atomic)`** -- Convert USDC atomic units to USD cents

## License

MIT
