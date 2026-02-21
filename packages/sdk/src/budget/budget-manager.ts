import { Money } from "@boltzpay/core";
import { readJson, writeJson } from "../persistence/storage";

/** Resolved budget limits in Money. Created from `BudgetConfig` at construction time. */
export interface BudgetLimits {
  readonly daily: Money | undefined;
  readonly monthly: Money | undefined;
  readonly perTransaction: Money | undefined;
  readonly warningThreshold: number;
  /** 1 sat = X USD. Used to convert L402 sats to USD for budget accounting. */
  readonly satToUsdRate: number;
}

/** Current budget spending state returned by `BoltzPay.getBudget()`. */
export interface BudgetState {
  readonly dailySpent: Money;
  readonly monthlySpent: Money;
  readonly dailyLimit: Money | undefined;
  readonly monthlyLimit: Money | undefined;
  readonly perTransactionLimit: Money | undefined;
  readonly dailyRemaining: Money | undefined;
  readonly monthlyRemaining: Money | undefined;
}

type BudgetCheckResult =
  | { readonly exceeded: false }
  | {
      readonly exceeded: true;
      readonly period: "daily" | "monthly" | "per_transaction";
      readonly limit: Money;
    };

type BudgetWarningResult =
  | { readonly warning: false }
  | {
      readonly warning: true;
      readonly period: "daily" | "monthly";
      readonly spent: Money;
      readonly limit: Money;
      readonly usage: number;
    };

// sats → cents conversion uses scaled bigint to avoid float precision loss.
// cents = sats * rate * 100, computed as: sats * rateScaled / RATE_PRECISION
const RATE_PRECISION = 1_000_000n;

// Warning threshold comparison uses basis points to avoid Number(bigint) precision loss.
const WARNING_BASIS_POINTS = 10000n;

interface PersistedBudget {
  readonly dailySpent: string;
  readonly monthlySpent: string;
  readonly lastDailyReset: string;
  readonly lastMonthlyReset: string;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export class BudgetManager {
  private dailySpent: Money = Money.zero();
  private monthlySpent: Money = Money.zero();
  private readonly limits: BudgetLimits | undefined;
  private readonly persistPath: string | undefined;

  constructor(limits: BudgetLimits | undefined, persistPath?: string) {
    this.limits = limits;
    this.persistPath = persistPath;

    if (persistPath) {
      this.loadFromFile(persistPath);
    }
  }

  /** Convert a SATS amount to USD equivalent using the configured rate. USD amounts pass through. */
  convertToUsd(amount: Money): Money {
    if (amount.currency === "USD") return amount;
    const rate = this.limits?.satToUsdRate ?? 0.001;
    const rateScaled = BigInt(Math.round(rate * 100 * Number(RATE_PRECISION)));
    const cents = (amount.cents * rateScaled) / RATE_PRECISION;
    // Minimum 1 cent if sats > 0 (never lose a payment from budget tracking)
    const finalCents = cents === 0n && amount.cents > 0n ? 1n : cents;
    return Money.fromCents(finalCents);
  }

  checkTransaction(amount: Money): BudgetCheckResult {
    if (!this.limits) {
      return { exceeded: false };
    }

    if (
      this.limits.perTransaction &&
      amount.greaterThan(this.limits.perTransaction)
    ) {
      return {
        exceeded: true,
        period: "per_transaction",
        limit: this.limits.perTransaction,
      };
    }

    if (
      this.limits.daily &&
      this.dailySpent.add(amount).greaterThan(this.limits.daily)
    ) {
      return { exceeded: true, period: "daily", limit: this.limits.daily };
    }

    if (
      this.limits.monthly &&
      this.monthlySpent.add(amount).greaterThan(this.limits.monthly)
    ) {
      return { exceeded: true, period: "monthly", limit: this.limits.monthly };
    }

    return { exceeded: false };
  }

  recordSpending(amount: Money): void {
    this.dailySpent = this.dailySpent.add(amount);
    this.monthlySpent = this.monthlySpent.add(amount);
    this.saveToFile();
  }

  checkWarning(): BudgetWarningResult {
    if (!this.limits) {
      return { warning: false };
    }

    const dailyWarning = this.checkPeriodWarning(
      this.dailySpent,
      this.limits.daily,
      "daily",
    );
    if (dailyWarning) return dailyWarning;

    const monthlyWarning = this.checkPeriodWarning(
      this.monthlySpent,
      this.limits.monthly,
      "monthly",
    );
    if (monthlyWarning) return monthlyWarning;

    return { warning: false };
  }

  resetDaily(): void {
    this.dailySpent = Money.zero();
    this.saveToFile();
  }

  getState(): BudgetState {
    return {
      dailySpent: this.dailySpent,
      monthlySpent: this.monthlySpent,
      dailyLimit: this.limits?.daily,
      monthlyLimit: this.limits?.monthly,
      perTransactionLimit: this.limits?.perTransaction,
      dailyRemaining: this.computeRemaining(
        this.dailySpent,
        this.limits?.daily,
      ),
      monthlyRemaining: this.computeRemaining(
        this.monthlySpent,
        this.limits?.monthly,
      ),
    };
  }

  private checkPeriodWarning(
    spent: Money,
    limit: Money | undefined,
    period: "daily" | "monthly",
  ): BudgetWarningResult | undefined {
    if (!limit || !this.limits) return undefined;

    const thresholdBp = BigInt(
      Math.round(this.limits.warningThreshold * Number(WARNING_BASIS_POINTS)),
    );
    const spentBp = spent.cents * WARNING_BASIS_POINTS;
    const limitScaled = limit.cents * thresholdBp;

    if (spentBp < limitScaled) return undefined;

    // Display-only usage ratio — acceptable float precision for UI, not financial decisions
    const usage = Number(spent.cents) / Number(limit.cents);
    return { warning: true, period, spent, limit, usage };
  }

  private computeRemaining(
    spent: Money,
    limit: Money | undefined,
  ): Money | undefined {
    if (!limit) return undefined;
    return limit.greaterThanOrEqual(spent)
      ? limit.subtract(spent)
      : Money.zero();
  }

  private loadFromFile(filePath: string): void {
    const data = readJson<PersistedBudget>(filePath);
    if (!data) return;

    const today = todayDate();
    const month = thisMonth();

    if (data.lastDailyReset === today) {
      this.dailySpent = Money.fromCents(BigInt(data.dailySpent));
    }
    if (data.lastMonthlyReset === month) {
      this.monthlySpent = Money.fromCents(BigInt(data.monthlySpent));
    }
  }

  private saveToFile(): void {
    if (!this.persistPath) return;

    const data: PersistedBudget = {
      dailySpent: this.dailySpent.cents.toString(),
      monthlySpent: this.monthlySpent.cents.toString(),
      lastDailyReset: todayDate(),
      lastMonthlyReset: thisMonth(),
    };
    writeJson(this.persistPath, data);
  }
}
