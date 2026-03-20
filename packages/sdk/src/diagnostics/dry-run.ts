import type { Money } from "@boltzpay/core";
import type { EndpointHealth } from "./diagnose";

export type DryRunFailureReason =
  | "domain_blocked"
  | "not_paid"
  | "detection_failed"
  | "unsupported_scheme"
  | "no_wallet_for_network"
  | "budget_exceeded"
  | "unsupported_network"
  | "network_error";

export interface DryRunResult {
  readonly wouldPay: boolean;
  readonly reason?: DryRunFailureReason;
  readonly quote?: {
    readonly amount: Money;
    readonly protocol: string;
    readonly network: string | undefined;
    readonly scheme: string;
  };
  readonly budgetCheck?: {
    readonly allowed: boolean;
    readonly dailyRemaining: Money | undefined;
    readonly monthlyRemaining: Money | undefined;
    readonly wouldExceed: "daily" | "monthly" | "per_transaction" | null;
  };
  readonly wallet?: {
    readonly name: string;
    readonly type: string;
  };
  readonly endpoint?: {
    readonly health: EndpointHealth;
    readonly formatVersion: string;
  };
}
