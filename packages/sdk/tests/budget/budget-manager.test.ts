import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import {
  type BudgetLimits,
  BudgetManager,
} from "../../src/budget/budget-manager";

function makeLimits(overrides: Partial<BudgetLimits> = {}): BudgetLimits {
  return {
    daily: undefined,
    monthly: undefined,
    perTransaction: undefined,
    warningThreshold: 0.8,
    ...overrides,
  };
}

describe("BudgetManager", () => {
  describe("no limits (undefined)", () => {
    it("checkTransaction always returns { exceeded: false }", () => {
      const mgr = new BudgetManager(undefined);
      const result = mgr.checkTransaction(Money.fromDollars("1000.00"));
      expect(result.exceeded).toBe(false);
    });
  });

  describe("per-transaction limit", () => {
    const limits = makeLimits({
      perTransaction: Money.fromDollars("10.00"),
    });

    it("amount below limit is not exceeded", () => {
      const mgr = new BudgetManager(limits);
      const result = mgr.checkTransaction(Money.fromDollars("5.00"));
      expect(result.exceeded).toBe(false);
    });

    it("amount equal to limit is not exceeded (exact limit passes)", () => {
      const mgr = new BudgetManager(limits);
      const result = mgr.checkTransaction(Money.fromDollars("10.00"));
      expect(result.exceeded).toBe(false);
    });

    it("amount above limit is exceeded with period per_transaction", () => {
      const mgr = new BudgetManager(limits);
      const result = mgr.checkTransaction(Money.fromDollars("10.01"));
      expect(result.exceeded).toBe(true);
      expect(result.period).toBe("per_transaction");
      expect(result.limit?.equals(Money.fromDollars("10.00"))).toBe(true);
    });
  });

  describe("daily limit", () => {
    const limits = makeLimits({
      daily: Money.fromDollars("20.00"),
    });

    it("single transaction below daily limit is not exceeded", () => {
      const mgr = new BudgetManager(limits);
      const result = mgr.checkTransaction(Money.fromDollars("15.00"));
      expect(result.exceeded).toBe(false);
    });

    it("cumulative exceeds after recording", () => {
      const mgr = new BudgetManager(limits);
      // Record $15
      mgr.recordSpending(Money.fromDollars("15.00"));
      // Try another $10 - total would be $25 > $20
      const result = mgr.checkTransaction(Money.fromDollars("10.00"));
      expect(result.exceeded).toBe(true);
      expect(result.period).toBe("daily");
    });

    it("exact limit reached is not exceeded", () => {
      const mgr = new BudgetManager(limits);
      mgr.recordSpending(Money.fromDollars("10.00"));
      // $10 + $10 = $20, exactly the limit
      const result = mgr.checkTransaction(Money.fromDollars("10.00"));
      expect(result.exceeded).toBe(false);
    });
  });

  describe("monthly limit", () => {
    it("cumulative exceeds monthly limit", () => {
      const limits = makeLimits({
        monthly: Money.fromDollars("100.00"),
      });
      const mgr = new BudgetManager(limits);
      mgr.recordSpending(Money.fromDollars("90.00"));
      const result = mgr.checkTransaction(Money.fromDollars("20.00"));
      expect(result.exceeded).toBe(true);
      expect(result.period).toBe("monthly");
    });
  });

  describe("resetDaily", () => {
    it("resets daily counter to zero, monthly unchanged", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("50.00"),
        monthly: Money.fromDollars("500.00"),
      });
      const mgr = new BudgetManager(limits);
      mgr.recordSpending(Money.fromDollars("30.00"));

      mgr.resetDaily();

      const state = mgr.getState();
      expect(state.dailySpent.isZero()).toBe(true);
      expect(state.monthlySpent.equals(Money.fromDollars("30.00"))).toBe(true);
    });
  });

  describe("getState", () => {
    it("returns correct dailySpent, monthlySpent, limits, remaining", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("100.00"),
        monthly: Money.fromDollars("1000.00"),
        perTransaction: Money.fromDollars("50.00"),
      });
      const mgr = new BudgetManager(limits);
      mgr.recordSpending(Money.fromDollars("25.00"));

      const state = mgr.getState();
      expect(state.dailySpent.equals(Money.fromDollars("25.00"))).toBe(true);
      expect(state.monthlySpent.equals(Money.fromDollars("25.00"))).toBe(true);
      expect(state.dailyLimit?.equals(Money.fromDollars("100.00"))).toBe(true);
      expect(state.monthlyLimit?.equals(Money.fromDollars("1000.00"))).toBe(
        true,
      );
      expect(
        state.perTransactionLimit?.equals(Money.fromDollars("50.00")),
      ).toBe(true);
      expect(state.dailyRemaining?.equals(Money.fromDollars("75.00"))).toBe(
        true,
      );
      expect(state.monthlyRemaining?.equals(Money.fromDollars("975.00"))).toBe(
        true,
      );
    });

    it("no limit on a period means remaining is undefined", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("100.00"),
      });
      const mgr = new BudgetManager(limits);
      const state = mgr.getState();
      expect(state.monthlyRemaining).toBeUndefined();
      expect(state.perTransactionLimit).toBeUndefined();
    });
  });

  describe("recordSpending", () => {
    it("increments both daily and monthly", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("100.00"),
        monthly: Money.fromDollars("1000.00"),
      });
      const mgr = new BudgetManager(limits);
      mgr.recordSpending(Money.fromDollars("10.00"));
      mgr.recordSpending(Money.fromDollars("20.00"));

      const state = mgr.getState();
      expect(state.dailySpent.equals(Money.fromDollars("30.00"))).toBe(true);
      expect(state.monthlySpent.equals(Money.fromDollars("30.00"))).toBe(true);
    });
  });

  describe("budget warnings", () => {
    it("daily at 80% triggers warning", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("100.00"),
      });
      const mgr = new BudgetManager(limits);
      mgr.recordSpending(Money.fromDollars("80.00"));
      const result = mgr.checkWarning();
      expect(result.warning).toBe(true);
      expect(result.period).toBe("daily");
      expect(result.usage).toBeCloseTo(0.8);
    });

    it("daily at 79% does not trigger warning", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("100.00"),
      });
      const mgr = new BudgetManager(limits);
      mgr.recordSpending(Money.fromDollars("79.00"));
      const result = mgr.checkWarning();
      expect(result.warning).toBe(false);
    });

    it("custom threshold 0.90 triggers warning at 90%", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("100.00"),
        warningThreshold: 0.9,
      });
      const mgr = new BudgetManager(limits);
      mgr.recordSpending(Money.fromDollars("90.00"));
      const result = mgr.checkWarning();
      expect(result.warning).toBe(true);
      expect(result.usage).toBeCloseTo(0.9);
    });
  });

  describe("warningThreshold edge cases", () => {
    it("should warn at 0% when threshold is 0", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("100.00"),
        warningThreshold: 0,
      });
      const mgr = new BudgetManager(limits);
      // No spending at all — threshold 0 means always warn
      const result = mgr.checkWarning();
      expect(result.warning).toBe(true);
      expect(result.period).toBe("daily");
    });

    it("should only warn at 100% when threshold is 1.0", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("100.00"),
        warningThreshold: 1.0,
      });
      const mgr = new BudgetManager(limits);

      // 99% should NOT warn
      mgr.recordSpending(Money.fromDollars("99.00"));
      const resultBelow = mgr.checkWarning();
      expect(resultBelow.warning).toBe(false);

      // Spending up to exactly 100% should warn
      mgr.recordSpending(Money.fromDollars("1.00"));
      const resultAt = mgr.checkWarning();
      expect(resultAt.warning).toBe(true);
      expect(resultAt.period).toBe("daily");
      expect(resultAt.usage).toBeCloseTo(1.0);
    });
  });
});
