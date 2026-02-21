import type { Money } from "@boltzpay/core";
import type { PaymentRecord } from "../history/types";

/** Emitted when spending reaches the configured warning threshold. */
export interface BudgetWarningEvent {
  readonly spent: Money;
  readonly limit: Money;
  readonly period: "daily" | "monthly";
  readonly usage: number;
}

/** Emitted when a payment is blocked by a budget limit. */
export interface BudgetExceededEvent {
  readonly requested: Money;
  readonly limit: Money;
  readonly period: "daily" | "monthly" | "per_transaction";
}

/** Event map for `BoltzPay.on()`. */
export interface BoltzPayEvents {
  payment: [PaymentRecord];
  "budget:warning": [BudgetWarningEvent];
  "budget:exceeded": [BudgetExceededEvent];
  error: [Error];
}

/** Valid event names for `BoltzPay.on()`. */
export type EventName = keyof BoltzPayEvents;

/** Callback type for a specific event. */
export type EventListener<E extends EventName> = (
  ...args: BoltzPayEvents[E]
) => void;
