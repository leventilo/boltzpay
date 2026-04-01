# @boltzpay/core

Domain primitives for the BoltzPay SDK — value objects, protocol interfaces, chain types, and error hierarchy. Zero I/O, zero dependencies.

## Install

```bash
npm install @boltzpay/core
```

> Most users should install `@boltzpay/sdk` instead. This package is for custom protocol adapters or when you need the domain types without the full SDK.

## Value Objects

**`Money`** — Immutable monetary value object. All arithmetic is bigint-based (no floating-point).

```ts
import { Money } from "@boltzpay/core";
```

Static constructors: `fromCents`, `fromDollars`, `fromSatoshis`, `fromJSON`, `zero`.
Methods: `add`, `subtract`, `multiply`, `isZero`, `greaterThan`, `greaterThanOrEqual`, `equals`, `toDisplayString`, `toJSON`.

## Protocol Interfaces

```ts
import type {
  ProtocolAdapter,
  ProtocolQuote,
  ProtocolResult,
  EndpointInputHints,
  MppMethodQuote,
  SessionAdapter,
  ManagedSession,
  SessionCloseResult,
  SessionOptions,
} from "@boltzpay/core";
```

- **`ProtocolAdapter`** — `detect`, `quote`, `execute` lifecycle for a payment protocol.
- **`ProtocolQuote`** / **`ProtocolResult`** — Quote and execution result returned by adapters.
- **`EndpointInputHints`** — Hints extracted from 402 metadata (method, query params, body fields).
- **`MppMethodQuote`** — Per-method quote for MPP endpoints.
- **`SessionAdapter`** — `openSession(url, options)` returns a `ManagedSession`.
- **`ManagedSession`** — Long-lived payment channel with `fetch`, `close`, `spent` tracking.
- **`SessionCloseResult`** — Final settlement: `channelId`, `totalSpent`, `refunded`.
- **`SessionOptions`** — `maxDeposit` cap and `AbortSignal` support.

## Protocol Types

```ts
import { isProtocolType, type ProtocolType } from "@boltzpay/core";
```

- **`ProtocolType`** — Branded non-empty string identifying a protocol (x402, L402, MPP, ...).
- **`isProtocolType`** — Type guard validating non-empty strings.

## Chain Types

```ts
import type {
  ChainNamespace,
  NetworkIdentifier,
  WalletInfo,
  AcceptOption,
} from "@boltzpay/core";
import { parseNetworkIdentifier, formatNetworkIdentifier } from "@boltzpay/core";
```

- **`ChainNamespace`** — `"evm"` | `"svm"` | `"stellar"`.
- **`NetworkIdentifier`** — Parsed CAIP-2 chain identifier (`{ namespace, reference }`).
- **`WalletInfo`** — Wallet addresses and balances per namespace.
- **`AcceptOption`** — Accepted payment option from a 402 response.
- **`parseNetworkIdentifier`** / **`formatNetworkIdentifier`** — CAIP-2 string conversion (e.g. `"eip155:8453"` for Base).

## Errors

```ts
import {
  DomainError,
  NegativeMoneyError,
  InvalidMoneyFormatError,
  CurrencyMismatchError,
  NoCompatibleChainError,
  ProtocolDetectionFailedError,
  InvalidNetworkIdentifierError,
} from "@boltzpay/core";
```

| Error | Code | When |
|---|---|---|
| `DomainError` | — | Base class for all domain errors |
| `NegativeMoneyError` | — | Negative amount or subtraction underflow |
| `InvalidMoneyFormatError` | — | Unparseable dollar string |
| `CurrencyMismatchError` | — | Arithmetic across USD / SATS |
| `NoCompatibleChainError` | `no_compatible_chain` | Wallet does not support the required chain |
| `ProtocolDetectionFailedError` | `protocol_detection_failed` | No adapter recognized the 402 response |
| `InvalidNetworkIdentifierError` | `invalid_network_identifier` | Malformed CAIP-2 string |

## License

MIT
