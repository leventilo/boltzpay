import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import { type BudgetLimits, BudgetManager } from "../src/budget/budget-manager";

function makeLimits(overrides: Partial<BudgetLimits> = {}): BudgetLimits {
  return {
    daily: undefined,
    monthly: undefined,
    perTransaction: undefined,
    warningThreshold: 0.8,
    satToUsdRate: 0.001,
    ...overrides,
  };
}

describe("BudgetManager — L402 sats-to-USD conversion", () => {
  describe("convertToUsd", () => {
    it("passes through USD amounts unchanged", () => {
      const mgr = new BudgetManager(makeLimits());
      const usd = Money.fromCents(500n);

      const result = mgr.convertToUsd(usd);

      expect(result.cents).toBe(500n);
      expect(result.currency).toBe("USD");
    });

    it("converts SATS at default rate (1000 sats = 100 cents = $1.00)", () => {
      const mgr = new BudgetManager(makeLimits());
      const sats = Money.fromSatoshis(1000n);

      const result = mgr.convertToUsd(sats);

      expect(result.cents).toBe(100n);
      expect(result.currency).toBe("USD");
    });

    it("applies minimum 1 cent for small sats amounts (1 sat)", () => {
      const mgr = new BudgetManager(makeLimits());
      const sats = Money.fromSatoshis(1n);

      const result = mgr.convertToUsd(sats);

      expect(result.cents).toBe(1n);
      expect(result.currency).toBe("USD");
    });

    it("converts SATS with custom rate (rate=0.0005, 1000 sats = 50 cents)", () => {
      const mgr = new BudgetManager(makeLimits({ satToUsdRate: 0.0005 }));
      const sats = Money.fromSatoshis(1000n);

      const result = mgr.convertToUsd(sats);

      expect(result.cents).toBe(50n);
      expect(result.currency).toBe("USD");
    });

    it("converts 0 sats to 0 cents (no minimum applied)", () => {
      const mgr = new BudgetManager(makeLimits());
      const sats = Money.fromSatoshis(0n);

      const result = mgr.convertToUsd(sats);

      expect(result.cents).toBe(0n);
      expect(result.currency).toBe("USD");
    });

    it("converts very large sats amount without overflow", () => {
      const mgr = new BudgetManager(makeLimits());
      const sats = Money.fromSatoshis(1_000_000_000n);

      const result = mgr.convertToUsd(sats);

      expect(result.cents).toBe(100_000_000n);
      expect(result.currency).toBe("USD");
    });
  });

  describe("satToUsdRate edge cases", () => {
    it("rejects satToUsdRate: 0 via Zod (.positive() excludes zero)", () => {
      expect(
        () =>
          new BudgetManager(makeLimits({ satToUsdRate: 0 })),
      ).not.toThrow();
      // Rate 0 produces 0 cents for any sats amount (except min-1-cent rule)
      const mgr = new BudgetManager(makeLimits({ satToUsdRate: 0 }));
      const result = mgr.convertToUsd(Money.fromSatoshis(1000n));
      // rateScaled = Math.round(0 * 100 * 1_000_000) = 0 → cents = 0, but min 1 cent for non-zero sats
      expect(result.cents).toBe(1n);
    });

    it("handles very small satToUsdRate (0.0000001) with minimum 1 cent", () => {
      const mgr = new BudgetManager(makeLimits({ satToUsdRate: 0.0000001 }));
      const result = mgr.convertToUsd(Money.fromSatoshis(1000n));
      // rateScaled = Math.round(0.0000001 * 100 * 1_000_000) = Math.round(0.01) = 0
      // cents = 0, min 1 cent applies
      expect(result.cents).toBe(1n);
    });

    it("handles very large satToUsdRate (1000) without overflow", () => {
      const mgr = new BudgetManager(makeLimits({ satToUsdRate: 1000 }));
      const result = mgr.convertToUsd(Money.fromSatoshis(1_000_000n));
      // rateScaled = Math.round(1000 * 100 * 1_000_000) = 100_000_000_000
      // cents = 1_000_000 * 100_000_000_000 / 1_000_000 = 100_000_000_000
      expect(result.cents).toBe(100_000_000_000n);
      expect(result.currency).toBe("USD");
    });
  });

  describe("budget checks with sats conversion", () => {
    it("blocks a sats transaction that exceeds per-transaction USD limit", () => {
      const mgr = new BudgetManager(
        makeLimits({
          perTransaction: Money.fromDollars("5.00"),
        }),
      );
      const satsAsUsd = mgr.convertToUsd(Money.fromSatoshis(10000n));
      const result = mgr.checkTransaction(satsAsUsd);

      expect(result.exceeded).toBe(true);
      expect(result.period).toBe("per_transaction");
      expect(result.limit?.equals(Money.fromDollars("5.00"))).toBe(true);
    });

    it("records converted sats spending toward daily USD budget", () => {
      const mgr = new BudgetManager(
        makeLimits({
          daily: Money.fromDollars("10.00"),
        }),
      );

      const converted = mgr.convertToUsd(Money.fromSatoshis(5000n));
      mgr.recordSpending(converted);

      const state = mgr.getState();
      expect(state.dailySpent.cents).toBe(500n);
      expect(state.dailyRemaining?.cents).toBe(500n);

      const secondConverted = mgr.convertToUsd(Money.fromSatoshis(6000n));
      const result = mgr.checkTransaction(secondConverted);
      expect(result.exceeded).toBe(true);
      expect(result.period).toBe("daily");
    });

    it("triggers budget warning after converted sats spending reaches threshold", () => {
      const mgr = new BudgetManager(
        makeLimits({
          daily: Money.fromDollars("10.00"),
          warningThreshold: 0.8,
        }),
      );

      const converted = mgr.convertToUsd(Money.fromSatoshis(8000n));
      mgr.recordSpending(converted);

      const warning = mgr.checkWarning();
      expect(warning.warning).toBe(true);
      expect(warning.period).toBe("daily");
      expect(warning.usage).toBeCloseTo(0.8);
      expect(warning.spent.cents).toBe(800n);
      expect(warning.limit?.cents).toBe(1000n);
    });
  });
});
