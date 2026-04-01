type BudgetExceededCode =
  | "daily_budget_exceeded"
  | "monthly_budget_exceeded"
  | "per_transaction_exceeded";

export const BUDGET_EXCEEDED_CODES = {
  daily: "daily_budget_exceeded",
  monthly: "monthly_budget_exceeded",
  per_transaction: "per_transaction_exceeded",
} as const satisfies Record<string, BudgetExceededCode>;

export function toBudgetExceededCode(
  period: "daily" | "monthly" | "per_transaction",
): BudgetExceededCode {
  return BUDGET_EXCEEDED_CODES[period];
}
