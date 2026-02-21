import type { Money } from "@boltzpay/core";
import { BoltzPayError } from "./boltzpay-error";

type BudgetExceededErrorCode =
  | "daily_budget_exceeded"
  | "monthly_budget_exceeded"
  | "per_transaction_exceeded";

/** Thrown when a payment would exceed a configured budget limit. Carries `requested` and `limit` Money values. */
export class BudgetExceededError extends BoltzPayError {
  readonly code: BudgetExceededErrorCode;
  readonly statusCode = 429;
  readonly requested: Money;
  readonly limit: Money;

  constructor(code: BudgetExceededErrorCode, requested: Money, limit: Money) {
    super(
      `Budget exceeded: requested ${requested.toDisplayString()}, limit ${limit.toDisplayString()}`,
    );
    this.code = code;
    this.requested = requested;
    this.limit = limit;
  }
}
