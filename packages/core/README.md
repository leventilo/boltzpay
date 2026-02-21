# @boltzpay/core

Domain primitives for the BoltzPay SDK -- value objects, protocol interfaces, and shared types.

## Install

```bash
npm install @boltzpay/core
```

> Most users should install `@boltzpay/sdk` instead. This package is useful if you are building a custom protocol adapter or need the domain types without the full SDK.

## Exports

### Value Objects

- **`Money`** -- Immutable monetary value object with safe arithmetic (`add`, `subtract`, `multiply`, `isZero`, `isGreaterThan`, `toDisplayString`)

### Protocol Interfaces

- **`ProtocolAdapter`** -- Interface for implementing payment protocol adapters
- **`ProtocolQuote`** -- Quote result from a protocol adapter
- **`ProtocolResult`** -- Payment result from a protocol adapter
- **`EndpointInputHints`** -- Hints extracted from 402 metadata (method, content-type, body schema)

### Chain Types

- **`ChainNamespace`** -- `"eip155"` (EVM) or `"solana"`
- **`NetworkIdentifier`** -- Chain identifier (e.g., `eip155:8453` for Base)
- **`WalletInfo`** -- Wallet address and chain info
- **`AcceptOption`** -- Accepted payment option from a 402 response

### Errors

- **`DomainError`** -- Base error class
- **`NegativeMoneyError`** -- Negative amount rejected
- **`InvalidMoneyFormatError`** -- Unparseable money string
- **`CurrencyMismatchError`** -- Arithmetic on different currencies
- **`NoCompatibleChainError`** -- No wallet matches the required chain
- **`ProtocolDetectionFailedError`** -- No adapter recognized the 402 response

## License

MIT
