import type { Money } from "@boltzpay/core";
import { BoltzPayError } from "./boltzpay-error";

export class MppSessionError extends BoltzPayError {
  readonly code = "mpp_session_failed" as const;
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
  }
}

export class MppSessionBudgetError extends BoltzPayError {
  readonly code = "session_budget_exceeded" as const;
  readonly statusCode = 429;
  readonly requested: Money;
  readonly limit: Money;

  constructor(requested: Money, limit: Money) {
    super(
      `Session budget exceeded: requested ${requested.toDisplayString()}, limit ${limit.toDisplayString()}`,
    );
    this.requested = requested;
    this.limit = limit;
  }
}
