import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Money } from "@boltzpay/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BudgetLimits,
  BudgetManager,
} from "../src/budget/budget-manager";

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

function tmpFilePath(suffix: string): string {
  return join(tmpdir(), `boltzpay-test-budget-${Date.now()}-${suffix}.json`);
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
  const filesToClean: string[] = [];

  afterEach(() => {
    for (const f of filesToClean) {
      if (existsSync(f)) {
        unlinkSync(f);
      }
    }
    filesToClean.length = 0;
  });

  it("no persistence path does not create any file", () => {
    const mgr = new BudgetManager(makeLimits());
    mgr.recordSpending(Money.fromDollars("10.00"));

    const state = mgr.getState();
    expect(state.dailySpent.equals(Money.fromDollars("10.00"))).toBe(true);
  });

  it("saves budget to file after recordSpending", () => {
    const filePath = tmpFilePath("save");
    filesToClean.push(filePath);

    const mgr = new BudgetManager(makeLimits(), filePath);
    mgr.recordSpending(Money.fromDollars("25.00"));

    expect(existsSync(filePath)).toBe(true);

    const data = JSON.parse(readFileSync(filePath, "utf-8")) as PersistedBudget;
    expect(data.dailySpent).toBe("2500");
    expect(data.monthlySpent).toBe("2500");
    expect(data.lastDailyReset).toBe(todayDate());
    expect(data.lastMonthlyReset).toBe(thisMonth());
  });

  it("loads budget from existing file on construction", () => {
    const filePath = tmpFilePath("load");
    filesToClean.push(filePath);

    const first = new BudgetManager(makeLimits(), filePath);
    first.recordSpending(Money.fromDollars("30.00"));

    const second = new BudgetManager(makeLimits(), filePath);
    const state = second.getState();

    expect(state.dailySpent.equals(Money.fromDollars("30.00"))).toBe(true);
    expect(state.monthlySpent.equals(Money.fromDollars("30.00"))).toBe(true);
  });

  it("daily auto-reset when lastDailyReset is yesterday", () => {
    const filePath = tmpFilePath("daily-reset");
    filesToClean.push(filePath);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const data: PersistedBudget = {
      dailySpent: "5000",
      monthlySpent: "5000",
      lastDailyReset: yesterdayStr,
      lastMonthlyReset: thisMonth(),
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

    const mgr = new BudgetManager(makeLimits(), filePath);
    const state = mgr.getState();

    expect(state.dailySpent.isZero()).toBe(true);
    expect(state.monthlySpent.equals(Money.fromDollars("50.00"))).toBe(true);
  });

  it("monthly auto-reset when lastMonthlyReset is a past month", () => {
    const filePath = tmpFilePath("monthly-reset");
    filesToClean.push(filePath);

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
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

    const mgr = new BudgetManager(makeLimits(), filePath);
    const state = mgr.getState();

    expect(state.dailySpent.isZero()).toBe(true);
    expect(state.monthlySpent.isZero()).toBe(true);
  });

  it("corrupt file leads to fresh start (zero budget)", () => {
    const filePath = tmpFilePath("corrupt");
    filesToClean.push(filePath);

    writeFileSync(filePath, "{{{not valid json", "utf-8");

    const mgr = new BudgetManager(makeLimits(), filePath);
    const state = mgr.getState();

    expect(state.dailySpent.isZero()).toBe(true);
    expect(state.monthlySpent.isZero()).toBe(true);
  });

  it("missing file leads to fresh start (zero budget)", () => {
    const filePath = tmpFilePath("missing");
    filesToClean.push(filePath);

    const mgr = new BudgetManager(makeLimits(), filePath);
    const state = mgr.getState();

    expect(state.dailySpent.isZero()).toBe(true);
    expect(state.monthlySpent.isZero()).toBe(true);
  });

  it("first run creates file on recordSpending", () => {
    const filePath = tmpFilePath("first-run");
    filesToClean.push(filePath);

    expect(existsSync(filePath)).toBe(false);

    const mgr = new BudgetManager(makeLimits(), filePath);
    mgr.recordSpending(Money.fromDollars("5.00"));

    expect(existsSync(filePath)).toBe(true);

    const data = JSON.parse(readFileSync(filePath, "utf-8")) as PersistedBudget;
    expect(data.dailySpent).toBe("500");
    expect(data.monthlySpent).toBe("500");
  });

  it("budget state survives save and reload across instances", () => {
    const filePath = tmpFilePath("survive");
    filesToClean.push(filePath);

    const first = new BudgetManager(makeLimits(), filePath);
    first.recordSpending(Money.fromDollars("10.00"));
    first.recordSpending(Money.fromDollars("20.00"));

    const second = new BudgetManager(makeLimits(), filePath);
    second.recordSpending(Money.fromDollars("5.00"));

    const state = second.getState();
    expect(state.dailySpent.equals(Money.fromDollars("35.00"))).toBe(true);
    expect(state.monthlySpent.equals(Money.fromDollars("35.00"))).toBe(true);

    const data = JSON.parse(readFileSync(filePath, "utf-8")) as PersistedBudget;
    expect(data.dailySpent).toBe("3500");
    expect(data.monthlySpent).toBe("3500");
  });

  it("resetDaily saves zeroed daily to file while preserving monthly", () => {
    const filePath = tmpFilePath("reset-daily");
    filesToClean.push(filePath);

    const mgr = new BudgetManager(makeLimits(), filePath);
    mgr.recordSpending(Money.fromDollars("40.00"));

    mgr.resetDaily();

    const state = mgr.getState();
    expect(state.dailySpent.isZero()).toBe(true);
    expect(state.monthlySpent.equals(Money.fromDollars("40.00"))).toBe(true);

    const data = JSON.parse(readFileSync(filePath, "utf-8")) as PersistedBudget;
    expect(data.dailySpent).toBe("0");
    expect(data.monthlySpent).toBe("4000");
  });

  it("budget check respects loaded state (spending accumulates from file)", () => {
    const filePath = tmpFilePath("check-loaded");
    filesToClean.push(filePath);

    const data: PersistedBudget = {
      dailySpent: "9000",
      monthlySpent: "9000",
      lastDailyReset: todayDate(),
      lastMonthlyReset: thisMonth(),
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

    const mgr = new BudgetManager(makeLimits(), filePath);

    const result = mgr.checkTransaction(Money.fromDollars("15.00"));
    expect(result.exceeded).toBe(true);
    expect(result.period).toBe("daily");

    const resultOk = mgr.checkTransaction(Money.fromDollars("5.00"));
    expect(resultOk.exceeded).toBe(false);
  });
});
