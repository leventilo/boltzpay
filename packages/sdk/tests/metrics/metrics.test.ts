import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../src/metrics/metrics";
import type { PaymentMetrics } from "../../src/metrics/metrics";
import type { PaymentRecord } from "../../src/history/types";

function makeRecord(
  id: number,
  opts?: { dollars?: string; durationMs?: number },
): PaymentRecord {
  return {
    id: `record-${id}`,
    url: `https://api.example.com/resource/${id}`,
    protocol: "x402",
    amount: Money.fromDollars(opts?.dollars ?? "1.00"),
    timestamp: new Date(
      `2026-02-18T00:00:${String(id % 60).padStart(2, "0")}Z`,
    ),
    txHash: `0x${id.toString(16).padStart(8, "0")}`,
    network: "base",
    durationMs: opts?.durationMs,
  };
}

describe("computeMetrics", () => {
  it("empty records + 0 errors returns zeroed metrics", () => {
    const metrics: PaymentMetrics = computeMetrics([], 0);
    expect(metrics.totalSpent.isZero()).toBe(true);
    expect(metrics.callCount).toBe(0);
    expect(metrics.errorCount).toBe(0);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.avgLatencyMs).toBe(0);
    expect(metrics.successCount).toBe(0);
    expect(metrics.lastPaymentAt).toBeUndefined();
  });

  it("3 records ($1, $2, $3) + 1 error => correct totals", () => {
    const records = [
      makeRecord(1, { dollars: "1.00" }),
      makeRecord(2, { dollars: "2.00" }),
      makeRecord(3, { dollars: "3.00" }),
    ];
    const metrics = computeMetrics(records, 1);
    expect(metrics.totalSpent.equals(Money.fromDollars("6.00"))).toBe(true);
    expect(metrics.callCount).toBe(4); // 3 success + 1 error
    expect(metrics.errorCount).toBe(1);
    expect(metrics.errorRate).toBe(0.25);
    expect(metrics.successCount).toBe(3);
  });

  it("records with durationMs [100, 200, 300] => avgLatencyMs=200", () => {
    const records = [
      makeRecord(1, { durationMs: 100 }),
      makeRecord(2, { durationMs: 200 }),
      makeRecord(3, { durationMs: 300 }),
    ];
    const metrics = computeMetrics(records, 0);
    expect(metrics.avgLatencyMs).toBe(200);
  });

  it("records without durationMs => avgLatencyMs=0", () => {
    const records = [makeRecord(1), makeRecord(2)];
    const metrics = computeMetrics(records, 0);
    expect(metrics.avgLatencyMs).toBe(0);
  });

  it("mixed durationMs: only records with durationMs are averaged", () => {
    const records = [
      makeRecord(1, { durationMs: 100 }),
      makeRecord(2), // undefined
      makeRecord(3, { durationMs: 300 }),
    ];
    const metrics = computeMetrics(records, 0);
    expect(metrics.avgLatencyMs).toBe(200); // (100+300)/2
  });

  it("lastPaymentAt is timestamp of the last record", () => {
    const records = [makeRecord(1), makeRecord(2), makeRecord(3)];
    const metrics = computeMetrics(records, 0);
    expect(metrics.lastPaymentAt).toEqual(records[2].timestamp);
  });

  it("only errors (0 records, 5 errors)", () => {
    const metrics = computeMetrics([], 5);
    expect(metrics.callCount).toBe(5);
    expect(metrics.errorCount).toBe(5);
    expect(metrics.errorRate).toBe(1);
    expect(metrics.successCount).toBe(0);
    expect(metrics.totalSpent.isZero()).toBe(true);
  });

  it("avgLatencyMs is Math.round'd", () => {
    const records = [
      makeRecord(1, { durationMs: 100 }),
      makeRecord(2, { durationMs: 201 }),
    ];
    const metrics = computeMetrics(records, 0);
    // (100+201)/2 = 150.5 => Math.round => 151
    expect(metrics.avgLatencyMs).toBe(151);
  });
});
