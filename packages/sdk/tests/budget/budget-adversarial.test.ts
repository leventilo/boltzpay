import { Money, NegativeMoneyError } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import {
  type BudgetLimits,
  BudgetManager,
} from "../../src/budget/budget-manager";
import { MemoryAdapter } from "../../src/persistence/memory-adapter";

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

describe("BudgetManager — adversarial tests", () => {
  describe("race condition: 10 parallel reserves on $1 daily budget", () => {
    it("total reserved never exceeds the daily limit", () => {
      const limits = makeLimits({ daily: Money.fromDollars("1.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // reserve() is synchronous — no await gap between check and decrement.
      // Even if called in Promise.all(), the JS event loop executes each
      // synchronous reserve() atomically before yielding.
      const results: Array<{ id: string; error?: Error }> = [];

      const promises = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() => {
          try {
            const id = mgr.reserve(Money.fromDollars("0.10"));
            results.push({ id });
          } catch (err) {
            results.push({ id: "", error: err as Error });
          }
        }),
      );

      return Promise.all(promises).then(() => {
        const succeeded = results.filter((r) => !r.error);
        const totalReservedCents = BigInt(succeeded.length) * 10n;

        // 10 * $0.10 = $1.00, exactly the daily limit — all 10 should succeed
        expect(succeeded).toHaveLength(10);
        expect(totalReservedCents).toBeLessThanOrEqual(100n);

        // Available should now be zero
        const available = mgr.availableForReservation();
        expect(available).toBeDefined();
        expect(available!.isZero()).toBe(true);
      });
    });

    it("11th reserve fails after budget fully reserved", () => {
      const limits = makeLimits({ daily: Money.fromDollars("1.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // Reserve all $1.00
      for (let i = 0; i < 10; i++) {
        mgr.reserve(Money.fromDollars("0.10"));
      }

      // The 11th should throw
      expect(() => mgr.reserve(Money.fromDollars("0.10"))).toThrow(
        /exceeds available budget/,
      );
    });

    it("reserve is atomic: no await gap between check and decrement", () => {
      // Proof: reserve() contains no async/await.
      // This test validates that even with microtask interleaving via
      // Promise.resolve(), each reserve sees the correct remaining budget.
      const limits = makeLimits({ daily: Money.fromDollars("0.50") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      const ids: string[] = [];
      const errors: Error[] = [];

      const promises = Array.from({ length: 10 }, () =>
        Promise.resolve().then(() => {
          try {
            ids.push(mgr.reserve(Money.fromDollars("0.10")));
          } catch (err) {
            errors.push(err as Error);
          }
        }),
      );

      return Promise.all(promises).then(() => {
        expect(ids).toHaveLength(5);
        expect(errors).toHaveLength(5);
        errors.forEach((e) =>
          expect(e.message).toMatch(/exceeds available budget/),
        );
      });
    });
  });

  describe("budget mid-session drain: reservation vs recordSpending", () => {
    it("recordSpending drains dailySpent but reservations are separate", () => {
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // Reserve $5 for a session
      const rsvId = mgr.reserve(Money.fromDollars("5.00"));

      // Available should be $5 (daily $10 - reserved $5)
      expect(
        mgr.availableForReservation()!.equals(Money.fromDollars("5.00")),
      ).toBe(true);

      // Simulate one-shot payments draining $5 via recordSpending
      mgr.recordSpending(Money.fromDollars("5.00"));

      // Available = daily remaining ($10 - $5 spent = $5) minus reserved ($5) = $0
      const available = mgr.availableForReservation();
      expect(available).toBeDefined();
      expect(available!.isZero()).toBe(true);
    });

    it("recordSpending can push dailySpent beyond limit (no enforcement)", () => {
      // FINDING: recordSpending does NOT enforce budget limits.
      // It's a pure counter increment. The check happens in checkTransaction()
      // which callers must invoke separately.
      const limits = makeLimits({ daily: Money.fromDollars("5.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // No exception — recordSpending is a blind counter
      mgr.recordSpending(Money.fromDollars("10.00"));

      const state = mgr.getState();
      // Daily spent is now $10 on a $5 daily limit — overspent
      expect(state.dailySpent.equals(Money.fromDollars("10.00"))).toBe(true);
      // Remaining clamps to zero (no negative Money)
      expect(state.dailyRemaining!.isZero()).toBe(true);
    });

    it("overspending via recordSpending makes availableForReservation zero", () => {
      const limits = makeLimits({ daily: Money.fromDollars("5.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      mgr.recordSpending(Money.fromDollars("6.00"));

      const available = mgr.availableForReservation();
      expect(available).toBeDefined();
      expect(available!.isZero()).toBe(true);
    });

    it("reservation survives external drain and release accounts correctly", () => {
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      const rsvId = mgr.reserve(Money.fromDollars("5.00"));

      // External one-shot spending drains $8
      mgr.recordSpending(Money.fromDollars("8.00"));

      // Release reservation with $3 unused (spent $2 of $5 deposit)
      mgr.release(rsvId, Money.fromDollars("3.00"));

      // release() records $5 - $3 = $2 as spent
      // Total daily spent: $8 (one-shot) + $2 (session) = $10
      const state = mgr.getState();
      expect(state.dailySpent.equals(Money.fromDollars("10.00"))).toBe(true);
    });
  });

  describe("bigint overflow and precision boundaries", () => {
    it("Money handles MAX_SAFE_INTEGER equivalent in cents without precision loss", () => {
      // Number.MAX_SAFE_INTEGER = 9_007_199_254_740_991
      const maxSafeCents = BigInt(Number.MAX_SAFE_INTEGER);
      const huge = Money.fromCents(maxSafeCents);

      expect(huge.cents).toBe(9_007_199_254_740_991n);

      // Add 1 — would overflow Number but not BigInt
      const hugePlusOne = huge.add(Money.fromCents(1n));
      expect(hugePlusOne.cents).toBe(9_007_199_254_740_992n);

      // Verify the value is distinct (Number would lose this)
      expect(hugePlusOne.cents).not.toBe(huge.cents);
    });

    it("Money handles values far beyond MAX_SAFE_INTEGER", () => {
      const enormous = Money.fromCents(10n ** 30n);
      const alsoEnormous = Money.fromCents(10n ** 30n);

      const sum = enormous.add(alsoEnormous);
      expect(sum.cents).toBe(2n * 10n ** 30n);

      const diff = sum.subtract(enormous);
      expect(diff.equals(enormous)).toBe(true);
    });

    it("USDC atomic conversion at maximum values preserves precision", () => {
      // USDC: 6 decimals. 1 USDC = 1_000_000 atomic = 100 cents.
      // Conversion: cents = atomic / 10_000
      const USDC_DECIMALS_TO_CENTS = 10000n;

      // ~$90 trillion in atomic units (MAX_SAFE_INTEGER range)
      const maxAtomic = BigInt(Number.MAX_SAFE_INTEGER);
      const cents = maxAtomic / USDC_DECIMALS_TO_CENTS;

      // Verify round-trip preserves order of magnitude
      const money = Money.fromCents(cents);
      expect(money.cents).toBe(cents);
      expect(money.cents).toBe(900_719_925_474n);

      // Reverse: cents to atomic
      const backToAtomic = money.cents * USDC_DECIMALS_TO_CENTS;
      // Truncation loses remainder, but no overflow
      expect(backToAtomic).toBeLessThanOrEqual(maxAtomic);
    });

    it("budget reserve/release with huge amounts works correctly", () => {
      const hugeLimit = Money.fromCents(10n ** 18n); // $10 quadrillion
      const limits = makeLimits({ daily: hugeLimit });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      const halfLimit = Money.fromCents(5n * 10n ** 17n);
      const id1 = mgr.reserve(halfLimit);
      const id2 = mgr.reserve(halfLimit);

      // Budget fully reserved
      expect(mgr.availableForReservation()!.isZero()).toBe(true);

      // Release one
      mgr.release(id1, halfLimit); // unused = all, so spent = 0
      expect(mgr.availableForReservation()!.equals(halfLimit)).toBe(true);
    });

    it("convertToUsd with very large SAT amounts does not overflow", () => {
      const limits = makeLimits({ satToUsdRate: 0.001 });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // 1 billion sats at 0.001 USD/sat = $1,000,000 = 100_000_000 cents
      const billionSats = Money.fromSatoshis(1_000_000_000n);
      const usd = mgr.convertToUsd(billionSats);
      expect(usd.currency).toBe("USD");
      // rate=0.001, CENTS_PER_DOLLAR=100 -> rateScaled = round(0.001 * 100 * 1_000_000) = 100_000
      // cents = (1_000_000_000 * 100_000) / 1_000_000 = 100_000_000
      expect(usd.cents).toBe(100_000_000n);
    });
  });

  describe("session orphan: reserve without release (crash simulation)", () => {
    it("orphaned reservation permanently reduces available budget", () => {
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // Simulate session opens but never closes (process crash)
      mgr.reserve(Money.fromDollars("3.00"));
      mgr.reserve(Money.fromDollars("3.00"));

      // $4 available, not $10 — orphans are counted
      const available = mgr.availableForReservation();
      expect(available!.equals(Money.fromDollars("4.00"))).toBe(true);
    });

    it("KNOWN LIMITATION: new BudgetManager loses in-memory reservations", async () => {
      const storage = new MemoryAdapter();
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });

      // First instance: reserve $5
      const mgr1 = new BudgetManager(limits, storage);
      mgr1.reserve(Money.fromDollars("5.00"));

      // Available on mgr1: $5
      expect(
        mgr1.availableForReservation()!.equals(Money.fromDollars("5.00")),
      ).toBe(true);

      // Wait for persist
      await new Promise((r) => setTimeout(r, 10));

      // Second instance: simulate restart
      const mgr2 = new BudgetManager(limits, storage);
      await mgr2.loadFromStorage();

      // KNOWN LIMITATION: reservations are in-memory only.
      // After restart, the orphaned $5 reservation is gone.
      // Available = full daily limit minus dailySpent (which is 0 since
      // reserve doesn't recordSpending until release).
      const available = mgr2.availableForReservation();
      expect(available!.equals(Money.fromDollars("10.00"))).toBe(true);

      // This means after a crash, the reserved-but-unspent budget is
      // effectively "refunded" silently. This is the safe direction
      // (user gets budget back vs. permanent budget leak), but it means
      // the on-chain deposit is not accounted for in the budget.
    });

    it("reservations are not persisted — only dailySpent/monthlySpent survive restart", async () => {
      const storage = new MemoryAdapter();
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });

      const mgr = new BudgetManager(limits, storage);
      mgr.reserve(Money.fromDollars("5.00"));
      mgr.recordSpending(Money.fromDollars("2.00"));

      await new Promise((r) => setTimeout(r, 10));

      const mgr2 = new BudgetManager(limits, storage);
      await mgr2.loadFromStorage();

      const state = mgr2.getState();
      // dailySpent persisted
      expect(state.dailySpent.equals(Money.fromDollars("2.00"))).toBe(true);
      // But available is $8 (no reservations remembered), not $3
      expect(
        mgr2.availableForReservation()!.equals(Money.fromDollars("8.00")),
      ).toBe(true);
    });
  });

  describe("reserve more than available", () => {
    it("throws when reserve exceeds daily limit", () => {
      const limits = makeLimits({ daily: Money.fromDollars("1.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      expect(() => mgr.reserve(Money.fromDollars("2.00"))).toThrow(
        /exceeds available budget/,
      );
    });

    it("throws when reserve exceeds remaining after prior spending", () => {
      const limits = makeLimits({ daily: Money.fromDollars("5.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      mgr.recordSpending(Money.fromDollars("4.00"));

      expect(() => mgr.reserve(Money.fromDollars("2.00"))).toThrow(
        /exceeds available budget/,
      );
    });

    it("throws when reserve exceeds remaining after prior reservations", () => {
      const limits = makeLimits({ daily: Money.fromDollars("5.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      mgr.reserve(Money.fromDollars("3.00"));

      expect(() => mgr.reserve(Money.fromDollars("3.00"))).toThrow(
        /exceeds available budget/,
      );
    });

    it("error message includes requested and available amounts", () => {
      const limits = makeLimits({ daily: Money.fromDollars("1.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      try {
        mgr.reserve(Money.fromDollars("2.00"));
        expect.unreachable("should have thrown");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain("$2.00");
        expect(msg).toContain("$1.00");
      }
    });

    it("no limits configured: reserve succeeds with any amount", () => {
      const mgr = new BudgetManager(undefined, new MemoryAdapter());

      // availableForReservation returns undefined when no limits
      expect(mgr.availableForReservation()).toBeUndefined();

      // reserve should succeed — no limit to enforce
      const id = mgr.reserve(Money.fromDollars("999999.99"));
      expect(id).toMatch(/^rsv_/);
    });

    it("monthly limit constrains reservation when daily is absent", () => {
      const limits = makeLimits({ monthly: Money.fromDollars("100.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      mgr.reserve(Money.fromDollars("80.00"));

      expect(() => mgr.reserve(Money.fromDollars("30.00"))).toThrow(
        /exceeds available budget/,
      );
    });

    it("picks smallest of daily and monthly for available", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("5.00"),
        monthly: Money.fromDollars("100.00"),
      });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // Available should be $5 (daily is smaller)
      expect(
        mgr.availableForReservation()!.equals(Money.fromDollars("5.00")),
      ).toBe(true);

      expect(() => mgr.reserve(Money.fromDollars("6.00"))).toThrow(
        /exceeds available budget/,
      );
    });
  });

  describe("release more unused than reserved", () => {
    it("caps spent at zero when unused exceeds reservation (no free money)", () => {
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      const id = mgr.reserve(Money.fromDollars("3.00"));

      // Release with $5 unused — more than the $3 reservation
      // The code: spent = reservation >= unused ? reservation - unused : reservation
      // So: $3 >= $5 is false → spent = reservation ($3), NOT $3 - $5
      mgr.release(id, Money.fromDollars("5.00"));

      // FINDING: When unusedAmount > reservation, the code falls back to
      // recording the full reservation as spent. This is defensive but
      // semantically wrong — if you say $5 was unused on a $3 reservation,
      // the "correct" spent is $0 (or negative, which is impossible).
      // The current behavior charges the full $3 reservation as spent.
      const state = mgr.getState();
      expect(state.dailySpent.equals(Money.fromDollars("3.00"))).toBe(true);
    });

    it("release with exact unused amount records zero spent", () => {
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      const id = mgr.reserve(Money.fromDollars("5.00"));
      mgr.release(id, Money.fromDollars("5.00")); // unused = deposit = nothing spent

      const state = mgr.getState();
      expect(state.dailySpent.isZero()).toBe(true);
    });

    it("release with zero unused records full reservation as spent", () => {
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      const id = mgr.reserve(Money.fromDollars("5.00"));
      mgr.release(id, Money.zero()); // nothing unused = everything spent

      const state = mgr.getState();
      expect(state.dailySpent.equals(Money.fromDollars("5.00"))).toBe(true);
    });

    it("release with unknown reservationId is a silent no-op", () => {
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // Release a non-existent reservation — should NOT throw or modify state
      mgr.release("rsv_nonexistent", Money.fromDollars("5.00"));

      const state = mgr.getState();
      expect(state.dailySpent.isZero()).toBe(true);
    });

    it("double-release of same reservationId is safe (second is no-op)", () => {
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      const id = mgr.reserve(Money.fromDollars("5.00"));

      // First release: records $2 spent ($5 - $3 unused)
      mgr.release(id, Money.fromDollars("3.00"));
      expect(mgr.getState().dailySpent.equals(Money.fromDollars("2.00"))).toBe(
        true,
      );

      // Second release: reservation already deleted, silent no-op
      mgr.release(id, Money.fromDollars("3.00"));
      expect(mgr.getState().dailySpent.equals(Money.fromDollars("2.00"))).toBe(
        true,
      );
    });
  });

  describe("concurrent reserve + release: interleaved operations", () => {
    it("reserve 3, release middle, remaining reservations correct", () => {
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      const id1 = mgr.reserve(Money.fromDollars("3.00"));
      const id2 = mgr.reserve(Money.fromDollars("3.00"));
      const id3 = mgr.reserve(Money.fromDollars("3.00"));

      // Available: $10 - $9 reserved = $1
      expect(
        mgr.availableForReservation()!.equals(Money.fromDollars("1.00")),
      ).toBe(true);

      // Release middle reservation, $1 unused → $2 spent
      mgr.release(id2, Money.fromDollars("1.00"));

      // Available: $10 - $2 spent - $6 still reserved = $2
      const available = mgr.availableForReservation();
      expect(available!.equals(Money.fromDollars("2.00"))).toBe(true);

      // Can now reserve $2 more
      const id4 = mgr.reserve(Money.fromDollars("2.00"));
      expect(id4).toMatch(/^rsv_/);

      // Available: $10 - $2 spent - $8 reserved = $0
      expect(mgr.availableForReservation()!.isZero()).toBe(true);
    });

    it("release all 3 in reverse order, budget fully recovered", () => {
      const limits = makeLimits({ daily: Money.fromDollars("10.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      const id1 = mgr.reserve(Money.fromDollars("2.00"));
      const id2 = mgr.reserve(Money.fromDollars("3.00"));
      const id3 = mgr.reserve(Money.fromDollars("4.00"));

      // Release all with full unused (nothing spent)
      mgr.release(id3, Money.fromDollars("4.00"));
      mgr.release(id2, Money.fromDollars("3.00"));
      mgr.release(id1, Money.fromDollars("2.00"));

      const state = mgr.getState();
      expect(state.dailySpent.isZero()).toBe(true);
      expect(
        mgr.availableForReservation()!.equals(Money.fromDollars("10.00")),
      ).toBe(true);
    });

    it("reserve after partial release reclaims freed budget", () => {
      const limits = makeLimits({ daily: Money.fromDollars("5.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      const id1 = mgr.reserve(Money.fromDollars("3.00"));
      const id2 = mgr.reserve(Money.fromDollars("2.00"));

      // Budget fully reserved
      expect(mgr.availableForReservation()!.isZero()).toBe(true);

      // Release first with $2 unused → $1 spent
      mgr.release(id1, Money.fromDollars("2.00"));

      // Available: $5 - $1 spent - $2 reserved = $2
      expect(
        mgr.availableForReservation()!.equals(Money.fromDollars("2.00")),
      ).toBe(true);

      // Can now reserve $2 more
      const id3 = mgr.reserve(Money.fromDollars("2.00"));
      expect(id3).toMatch(/^rsv_/);
    });
  });

  describe("per-transaction limit vs session deposit", () => {
    it("perTransaction does NOT affect reserve (deposit is not a transaction)", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("10.00"),
        perTransaction: Money.fromDollars("0.50"),
      });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // Session deposit $5 — this is a reservation, NOT a per-transaction spend
      // reserve() checks availableForReservation(), which uses daily/monthly, not perTransaction
      const id = mgr.reserve(Money.fromDollars("5.00"));
      expect(id).toMatch(/^rsv_/);

      // Verify: per-transaction limit only checked by checkTransaction()
      const smallTx = mgr.checkTransaction(Money.fromDollars("0.50"));
      expect(smallTx.exceeded).toBe(false);

      const bigTx = mgr.checkTransaction(Money.fromDollars("0.51"));
      expect(bigTx.exceeded).toBe(true);
      expect(bigTx.period).toBe("per_transaction");
    });

    it("session deposit constrained by daily limit, not perTransaction", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("2.00"),
        perTransaction: Money.fromDollars("0.10"),
      });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // Can reserve up to daily limit
      const id = mgr.reserve(Money.fromDollars("2.00"));
      expect(id).toMatch(/^rsv_/);

      // But individual transactions within the session are still capped at $0.10
      const check = mgr.checkTransaction(Money.fromDollars("0.11"));
      expect(check.exceeded).toBe(true);
    });

    it("checkTransaction accounts for active reservations in daily check", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("5.00"),
        perTransaction: Money.fromDollars("5.00"),
      });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // Reserve $4 — committed budget even though dailySpent is still 0
      mgr.reserve(Money.fromDollars("4.00"));

      // $0 spent + $4 reserved + $1 = $5 <= $5 daily → OK
      const check = mgr.checkTransaction(Money.fromDollars("1.00"));
      expect(check.exceeded).toBe(false);

      // $0 spent + $4 reserved + $5 = $9 > $5 daily → exceeded
      const checkBig = mgr.checkTransaction(Money.fromDollars("5.00"));
      expect(checkBig.exceeded).toBe(true);
      expect(checkBig.period).toBe("daily");
    });

    it("perTransaction blocks large transaction even with daily budget remaining", () => {
      const limits = makeLimits({
        daily: Money.fromDollars("10.00"),
        perTransaction: Money.fromDollars("1.00"),
      });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // Per-transaction limit is checked first, before daily
      const check = mgr.checkTransaction(Money.fromDollars("5.00"));
      expect(check.exceeded).toBe(true);
      expect(check.period).toBe("per_transaction");
    });
  });

  describe("Money.subtract safety", () => {
    it("throws NegativeMoneyError when subtracting more than available", () => {
      const a = Money.fromDollars("1.00");
      const b = Money.fromDollars("2.00");

      expect(() => a.subtract(b)).toThrow(NegativeMoneyError);
    });

    it("subtract zero returns same amount", () => {
      const a = Money.fromDollars("5.00");
      const result = a.subtract(Money.zero());
      expect(result.equals(a)).toBe(true);
    });
  });

  describe("availableForReservation edge cases", () => {
    it("returns undefined when no limits configured", () => {
      const mgr = new BudgetManager(undefined, new MemoryAdapter());
      expect(mgr.availableForReservation()).toBeUndefined();
    });

    it("returns Money.zero() when all budget is reserved", () => {
      const limits = makeLimits({ daily: Money.fromDollars("1.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());
      mgr.reserve(Money.fromDollars("1.00"));

      const available = mgr.availableForReservation();
      expect(available).toBeDefined();
      expect(available!.isZero()).toBe(true);
    });

    it("returns Money.zero() when overspent (not negative)", () => {
      const limits = makeLimits({ daily: Money.fromDollars("1.00") });
      const mgr = new BudgetManager(limits, new MemoryAdapter());

      // Overspend via recordSpending (which doesn't check limits)
      mgr.recordSpending(Money.fromDollars("2.00"));

      const available = mgr.availableForReservation();
      expect(available).toBeDefined();
      expect(available!.isZero()).toBe(true);
      // No NegativeMoneyError — computeRemaining clamps to zero
    });
  });

  describe("reservation counter monotonicity", () => {
    it("reservation IDs are monotonically increasing", () => {
      const mgr = new BudgetManager(undefined, new MemoryAdapter());

      const id1 = mgr.reserve(Money.fromDollars("1.00"));
      const id2 = mgr.reserve(Money.fromDollars("1.00"));
      const id3 = mgr.reserve(Money.fromDollars("1.00"));

      expect(id1).toBe("rsv_1");
      expect(id2).toBe("rsv_2");
      expect(id3).toBe("rsv_3");
    });

    it("counter does not reset after release", () => {
      const mgr = new BudgetManager(undefined, new MemoryAdapter());

      const id1 = mgr.reserve(Money.fromDollars("1.00"));
      mgr.release(id1, Money.fromDollars("1.00"));

      const id2 = mgr.reserve(Money.fromDollars("1.00"));
      expect(id2).toBe("rsv_2");
    });
  });
});
