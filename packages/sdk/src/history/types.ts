import type { Money } from "@boltzpay/core";

export interface PaymentRecord {
  readonly id: string;
  readonly url: string;
  readonly protocol: string;
  readonly amount: Money;
  readonly timestamp: Date;
  readonly txHash: string | undefined;
  readonly network: string | undefined;
  readonly durationMs?: number;
}

export interface PaymentDetails {
  readonly protocol: string;
  readonly amount: Money;
  readonly url: string;
  readonly timestamp: Date;
  readonly txHash: string | undefined;
}
