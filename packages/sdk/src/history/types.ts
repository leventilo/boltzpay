import type { Money } from "@boltzpay/core";

/** Immutable record of a completed payment, stored in `BoltzPay.getHistory()`. */
export interface PaymentRecord {
  readonly id: string;
  readonly url: string;
  readonly protocol: string;
  readonly amount: Money;
  readonly timestamp: Date;
  readonly txHash: string | undefined;
  readonly network: string | undefined;
}

/** Payment metadata attached to a `BoltzPayResponse` when a payment was made. */
export interface PaymentDetails {
  readonly protocol: string;
  readonly amount: Money;
  readonly url: string;
  readonly timestamp: Date;
  readonly txHash: string | undefined;
}
