import { Money } from "@boltzpay/core";
import type { StorageAdapter } from "../persistence/storage-adapter";

export interface BudgetLimits {
  readonly daily: Money | undefined;
  readonly monthly: Money | undefined;
  readonly perTransaction: Money | undefined;
  readonly warningThreshold: number;
  readonly satToUsdRate: number;
}

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

const RATE_PRECISION = 1_000_000n;
const WARNING_BASIS_POINTS = 10000n;
const BUDGET_STATE_KEY = "budget:state";
const DEFAULT_SAT_TO_USD_RATE = 0.001;
const CENTS_PER_DOLLAR = 100;
const MINIMUM_BUDGET_CENTS = 1n;
const DATE_SLICE_DAY = 10;
const DATE_SLICE_MONTH = 7;

interface PersistedBudget {
  readonly dailySpent: string;
  readonly monthlySpent: string;
  readonly lastDailyReset: string;
  readonly lastMonthlyReset: string;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, DATE_SLICE_DAY);
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, DATE_SLICE_MONTH);
}

export class BudgetManager {
  private dailySpent: Money = Money.zero();
  private monthlySpent: Money = Money.zero();
  private readonly limits: BudgetLimits | undefined;
  private readonly storage: StorageAdapter;

  constructor(limits: BudgetLimits | undefined, storage: StorageAdapter) {
    this.limits = limits;
    this.storage = storage;
  }

  async loadFromStorage(): Promise<void> {
    const raw = await this.storage.get(BUDGET_STATE_KEY);
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as PersistedBudget;
      const today = todayDate();
      const month = thisMonth();

      if (data.lastDailyReset === today) {
        this.dailySpent = Money.fromCents(BigInt(data.dailySpent));
      }
      if (data.lastMonthlyReset === month) {
        this.monthlySpent = Money.fromCents(BigInt(data.monthlySpent));
      }
    } catch {
      // Intent: corrupted budget state starts fresh — no data loss, only resets counters
    }
  }

  convertToUsd(amount: Money): Money {
    if (amount.currency === "USD") return amount;
    const rate = this.limits?.satToUsdRate ?? DEFAULT_SAT_TO_USD_RATE;
    const rateScaled = BigInt(
      Math.round(rate * CENTS_PER_DOLLAR * Number(RATE_PRECISION)),
    );
    const cents = (amount.cents * rateScaled) / RATE_PRECISION;
    const finalCents =
      cents === 0n && amount.cents > 0n ? MINIMUM_BUDGET_CENTS : cents;
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
    this.persistState();
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
    this.persistState();
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

  private persistState(): void {
    const data: PersistedBudget = {
      dailySpent: this.dailySpent.cents.toString(),
      monthlySpent: this.monthlySpent.cents.toString(),
      lastDailyReset: todayDate(),
      lastMonthlyReset: thisMonth(),
    };
    this.storage.set(BUDGET_STATE_KEY, JSON.stringify(data)).catch(() => {});
  }
}
