import type { Money } from "@boltzpay/core";
import type { PaymentRecord } from "../history/types";

export interface BudgetWarningEvent {
  readonly spent: Money;
  readonly limit: Money;
  readonly period: "daily" | "monthly";
  readonly usage: number;
}

export interface BudgetExceededEvent {
  readonly requested: Money;
  readonly limit: Money;
  readonly period: "daily" | "monthly" | "per_transaction";
}

export interface RetryAttemptEvent {
  readonly attempt: number;
  readonly maxRetries: number;
  readonly delay: number;
  readonly phase: string;
  readonly error: Error;
}

export interface RetryExhaustedEvent {
  readonly maxRetries: number;
  readonly phase: string;
  readonly error: Error;
}

export interface PaymentUncertainEvent {
  readonly url: string;
  readonly amount: Money;
  readonly protocol: string;
  readonly error: Error;
  readonly nonce?: string;
  readonly txHash?: string;
}

export interface UnsupportedSchemeEvent {
  readonly scheme: string;
  readonly maxAmount?: Money;
  readonly network?: string;
  readonly url: string;
}

export interface UnsupportedNetworkEvent {
  readonly namespace: string;
  readonly url: string;
}

export interface WalletSelectedEvent {
  readonly walletName: string;
  readonly network: string;
  readonly reason: string;
}

export interface BoltzPayEvents {
  payment: [PaymentRecord];
  "budget:warning": [BudgetWarningEvent];
  "budget:exceeded": [BudgetExceededEvent];
  "retry:attempt": [RetryAttemptEvent];
  "retry:exhausted": [RetryExhaustedEvent];
  "payment:uncertain": [PaymentUncertainEvent];
  "protocol:unsupported-scheme": [UnsupportedSchemeEvent];
  "protocol:unsupported-network": [UnsupportedNetworkEvent];
  "wallet:selected": [WalletSelectedEvent];
  error: [Error];
}

export type EventName = keyof BoltzPayEvents;

export type EventListener<E extends EventName> = (
  ...args: BoltzPayEvents[E]
) => void;
