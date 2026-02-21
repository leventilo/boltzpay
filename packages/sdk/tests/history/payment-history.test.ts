import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import { PaymentHistory } from "../../src/history/payment-history";
import type { PaymentRecord } from "../../src/history/types";

function makeRecord(id: number): PaymentRecord {
  return {
    id: `record-${id}`,
    url: `https://api.example.com/resource/${id}`,
    protocol: "x402",
    amount: Money.fromDollars("1.00"),
    timestamp: new Date(
      `2026-02-18T00:00:${String(id % 60).padStart(2, "0")}Z`,
    ),
    txHash: `0x${id.toString(16).padStart(8, "0")}`,
    network: "base",
  };
}

describe("PaymentHistory", () => {
  it("empty history returns empty array from getAll()", () => {
    const history = new PaymentHistory();
    expect(history.getAll()).toEqual([]);
  });

  it("add one record, getAll() returns [record]", () => {
    const history = new PaymentHistory();
    const record = makeRecord(1);
    history.add(record);
    const all = history.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("record-1");
  });

  it("add 100 records, length is 100", () => {
    const history = new PaymentHistory();
    for (let i = 0; i < 100; i++) {
      history.add(makeRecord(i));
    }
    expect(history.length).toBe(100);
  });

  it("add 101 records, length is 100 and oldest is removed (FIFO)", () => {
    const history = new PaymentHistory();
    for (let i = 0; i < 101; i++) {
      history.add(makeRecord(i));
    }
    expect(history.length).toBe(100);
    const all = history.getAll();
    // Record 0 should have been evicted
    expect(all[0].id).toBe("record-1");
    // Record 100 should be the last one
    expect(all[99].id).toBe("record-100");
  });

  it("getAll() returns a copy, not reference", () => {
    const history = new PaymentHistory();
    history.add(makeRecord(1));
    const copy1 = history.getAll();
    const copy2 = history.getAll();
    // Different array references
    expect(copy1).not.toBe(copy2);
    // Mutating returned array doesn't affect internal state
    (copy1 as PaymentRecord[]).length = 0;
    expect(history.getAll()).toHaveLength(1);
  });

  it("records have correct PaymentRecord shape", () => {
    const history = new PaymentHistory();
    const record = makeRecord(42);
    history.add(record);
    const all = history.getAll();
    const r = all[0];
    expect(r.id).toBe("record-42");
    expect(r.url).toBe("https://api.example.com/resource/42");
    expect(r.protocol).toBe("x402");
    expect(r.amount.equals(Money.fromDollars("1.00"))).toBe(true);
    expect(r.timestamp).toBeInstanceOf(Date);
    expect(r.txHash).toBeDefined();
    expect(r.network).toBe("base");
  });

  it("length property matches actual count", () => {
    const history = new PaymentHistory();
    expect(history.length).toBe(0);
    history.add(makeRecord(1));
    expect(history.length).toBe(1);
    history.add(makeRecord(2));
    expect(history.length).toBe(2);
  });
});
