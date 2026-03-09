import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import {
  type BudgetLimits,
  BudgetManager,
} from "../src/budget/budget-manager";
import { MemoryAdapter } from "../src/persistence/memory-adapter";

function makeLimits(overrides: Partial<BudgetLimits> = {}): BudgetLimits {
  return {
    daily: Money.fromDollars("100.00"),
    monthly: Money.fromDollars("1000.00"),
    perTransaction: Money.fromDollars("50.00"),
    warningThreshold: 0.8,
    satToUsdRate: 0.001,
    ...overrides,
  };
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

interface PersistedBudget {
  readonly dailySpent: string;
  readonly monthlySpent: string;
  readonly lastDailyReset: string;
  readonly lastMonthlyReset: string;
}

describe("BudgetManager — persistence", () => {
  it("no persistence creates no storage entries", async () => {
    const storage = new MemoryAdapter();
    const mgr = new BudgetManager(makeLimits(), storage);
    mgr.recordSpending(Money.fromDollars("10.00"));

    const state = mgr.getState();
    expect(state.dailySpent.equals(Money.fromDollars("10.00"))).toBe(true);
  });

  it("saves budget to storage after recordSpending", async () => {
    const storage = new MemoryAdapter();
    const mgr = new BudgetManager(makeLimits(), storage);
    mgr.recordSpending(Money.fromDollars("25.00"));

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const raw = await storage.get("budget:state");
    expect(raw).toBeDefined();

    const data = JSON.parse(raw!) as PersistedBudget;
    expect(data.dailySpent).toBe("2500");
    expect(data.monthlySpent).toBe("2500");
    expect(data.lastDailyReset).toBe(todayDate());
    expect(data.lastMonthlyReset).toBe(thisMonth());
  });

  it("loads budget from existing storage on loadFromStorage", async () => {
    const storage = new MemoryAdapter();
    const first = new BudgetManager(makeLimits(), storage);
    first.recordSpending(Money.fromDollars("30.00"));

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const second = new BudgetManager(makeLimits(), storage);
    await second.loadFromStorage();
    const state = second.getState();

    expect(state.dailySpent.equals(Money.fromDollars("30.00"))).toBe(true);
    expect(state.monthlySpent.equals(Money.fromDollars("30.00"))).toBe(true);
  });

  it("daily auto-reset when lastDailyReset is yesterday", async () => {
    const storage = new MemoryAdapter();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const data: PersistedBudget = {
      dailySpent: "5000",
      monthlySpent: "5000",
      lastDailyReset: yesterdayStr,
      lastMonthlyReset: thisMonth(),
    };
    await storage.set("budget:state", JSON.stringify(data));

    const mgr = new BudgetManager(makeLimits(), storage);
    await mgr.loadFromStorage();
    const state = mgr.getState();

    expect(state.dailySpent.isZero()).toBe(true);
    expect(state.monthlySpent.equals(Money.fromDollars("50.00"))).toBe(true);
  });

  it("monthly auto-reset when lastMonthlyReset is a past month", async () => {
    const storage = new MemoryAdapter();

    const now = new Date();
    const pastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const pastMonthStr = pastMonth.toISOString().slice(0, 7);
    const pastDayStr = pastMonth.toISOString().slice(0, 10);

    const data: PersistedBudget = {
      dailySpent: "3000",
      monthlySpent: "15000",
      lastDailyReset: pastDayStr,
      lastMonthlyReset: pastMonthStr,
    };
    await storage.set("budget:state", JSON.stringify(data));

    const mgr = new BudgetManager(makeLimits(), storage);
    await mgr.loadFromStorage();
    const state = mgr.getState();

    expect(state.dailySpent.isZero()).toBe(true);
    expect(state.monthlySpent.isZero()).toBe(true);
  });

  it("corrupt data leads to fresh start (zero budget)", async () => {
    const storage = new MemoryAdapter();
    await storage.set("budget:state", "{{{not valid json");

    const mgr = new BudgetManager(makeLimits(), storage);
    await mgr.loadFromStorage();
    const state = mgr.getState();

    expect(state.dailySpent.isZero()).toBe(true);
    expect(state.monthlySpent.isZero()).toBe(true);
  });

  it("missing data leads to fresh start (zero budget)", async () => {
    const storage = new MemoryAdapter();

    const mgr = new BudgetManager(makeLimits(), storage);
    await mgr.loadFromStorage();
    const state = mgr.getState();

    expect(state.dailySpent.isZero()).toBe(true);
    expect(state.monthlySpent.isZero()).toBe(true);
  });

  it("budget state survives save and reload across instances", async () => {
    const storage = new MemoryAdapter();

    const first = new BudgetManager(makeLimits(), storage);
    first.recordSpending(Money.fromDollars("10.00"));
    first.recordSpending(Money.fromDollars("20.00"));

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const second = new BudgetManager(makeLimits(), storage);
    await second.loadFromStorage();
    second.recordSpending(Money.fromDollars("5.00"));

    const state = second.getState();
    expect(state.dailySpent.equals(Money.fromDollars("35.00"))).toBe(true);
    expect(state.monthlySpent.equals(Money.fromDollars("35.00"))).toBe(true);

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const raw = await storage.get("budget:state");
    const data = JSON.parse(raw!) as PersistedBudget;
    expect(data.dailySpent).toBe("3500");
    expect(data.monthlySpent).toBe("3500");
  });

  it("resetDaily saves zeroed daily to storage while preserving monthly", async () => {
    const storage = new MemoryAdapter();

    const mgr = new BudgetManager(makeLimits(), storage);
    mgr.recordSpending(Money.fromDollars("40.00"));

    mgr.resetDaily();

    const state = mgr.getState();
    expect(state.dailySpent.isZero()).toBe(true);
    expect(state.monthlySpent.equals(Money.fromDollars("40.00"))).toBe(true);

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const raw = await storage.get("budget:state");
    const data = JSON.parse(raw!) as PersistedBudget;
    expect(data.dailySpent).toBe("0");
    expect(data.monthlySpent).toBe("4000");
  });

  it("budget check respects loaded state (spending accumulates from storage)", async () => {
    const storage = new MemoryAdapter();

    const data: PersistedBudget = {
      dailySpent: "9000",
      monthlySpent: "9000",
      lastDailyReset: todayDate(),
      lastMonthlyReset: thisMonth(),
    };
    await storage.set("budget:state", JSON.stringify(data));

    const mgr = new BudgetManager(makeLimits(), storage);
    await mgr.loadFromStorage();

    const result = mgr.checkTransaction(Money.fromDollars("15.00"));
    expect(result.exceeded).toBe(true);
    expect(result.period).toBe("daily");

    const resultOk = mgr.checkTransaction(Money.fromDollars("5.00"));
    expect(resultOk.exceeded).toBe(false);
  });
});
