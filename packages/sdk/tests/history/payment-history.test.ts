import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import { PaymentHistory } from "../../src/history/payment-history";
import type { PaymentRecord } from "../../src/history/types";
import { MemoryAdapter } from "../../src/persistence/memory-adapter";

function makeRecord(id: number, opts?: { durationMs?: number }): PaymentRecord {
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
    durationMs: opts?.durationMs,
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

  it("add records up to default maxRecords, length matches", () => {
    const history = new PaymentHistory({ maxRecords: 5 });
    for (let i = 0; i < 5; i++) {
      history.add(makeRecord(i));
    }
    expect(history.length).toBe(5);
  });

  it("add records beyond maxRecords, oldest is removed (FIFO)", () => {
    const history = new PaymentHistory({ maxRecords: 3 });
    for (let i = 0; i < 4; i++) {
      history.add(makeRecord(i));
    }
    expect(history.length).toBe(3);
    const all = history.getAll();
    // Record 0 should have been evicted
    expect(all[0].id).toBe("record-1");
    expect(all[2].id).toBe("record-3");
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

  describe("durationMs field", () => {
    it("records with durationMs preserve the value", () => {
      const history = new PaymentHistory();
      history.add(makeRecord(1, { durationMs: 450 }));
      const all = history.getAll();
      expect(all[0].durationMs).toBe(450);
    });

    it("records without durationMs have undefined", () => {
      const history = new PaymentHistory();
      history.add(makeRecord(1));
      const all = history.getAll();
      expect(all[0].durationMs).toBeUndefined();
    });
  });

  describe("StorageAdapter persistence", () => {
    it("loadFromStorage reads persisted history records", async () => {
      const storage = new MemoryAdapter();
      const record = makeRecord(1, { durationMs: 250 });
      await storage.set(
        `history:${record.id}`,
        JSON.stringify({
          id: record.id,
          url: record.url,
          protocol: record.protocol,
          amount: { cents: record.amount.cents.toString(), currency: record.amount.currency },
          timestamp: record.timestamp.toISOString(),
          txHash: record.txHash,
          network: record.network,
          durationMs: record.durationMs,
        }),
      );

      const history = new PaymentHistory({ storage, maxRecords: 100 });
      await history.loadFromStorage();

      expect(history.length).toBe(1);
      const all = history.getAll();
      expect(all[0].id).toBe("record-1");
      expect(all[0].durationMs).toBe(250);
      expect(all[0].amount.equals(Money.fromDollars("1.00"))).toBe(true);
    });

    it("add() persists record via StorageAdapter fire-and-forget", async () => {
      const storage = new MemoryAdapter();
      const history = new PaymentHistory({ storage, maxRecords: 100 });

      history.add(makeRecord(1));

      // Wait for fire-and-forget persist
      await new Promise((r) => setTimeout(r, 10));

      const raw = await storage.get("history:record-1");
      expect(raw).toBeDefined();
      const data = JSON.parse(raw!);
      expect(data.id).toBe("record-1");
      expect(data.amount.cents).toBe("100");
    });

    it("rotation deletes old keys when records exceed maxRecords", async () => {
      const storage = new MemoryAdapter();
      const history = new PaymentHistory({ storage, maxRecords: 3 });

      history.add(makeRecord(1));
      history.add(makeRecord(2));
      history.add(makeRecord(3));
      history.add(makeRecord(4)); // triggers rotation, record-1 should be deleted

      // Wait for fire-and-forget persist
      await new Promise((r) => setTimeout(r, 50));

      expect(history.length).toBe(3);
      const all = history.getAll();
      expect(all[0].id).toBe("record-2");
      expect(all[2].id).toBe("record-4");

      // record-1 key should be deleted
      const deleted = await storage.get("history:record-1");
      expect(deleted).toBeUndefined();

      // record-4 key should exist
      const kept = await storage.get("history:record-4");
      expect(kept).toBeDefined();
    });

    it("durationMs serialization roundtrip through storage", async () => {
      const storage = new MemoryAdapter();
      const writer = new PaymentHistory({ storage, maxRecords: 100 });
      writer.add(makeRecord(1, { durationMs: 1234 }));

      // Wait for fire-and-forget persist
      await new Promise((r) => setTimeout(r, 10));

      const reader = new PaymentHistory({ storage, maxRecords: 100 });
      await reader.loadFromStorage();

      expect(reader.length).toBe(1);
      expect(reader.getAll()[0].durationMs).toBe(1234);
    });

    it("loadFromStorage trims to maxRecords", async () => {
      const storage = new MemoryAdapter();
      // Write 5 records
      for (let i = 0; i < 5; i++) {
        const record = makeRecord(i);
        await storage.set(
          `history:${record.id}`,
          JSON.stringify({
            id: record.id,
            url: record.url,
            protocol: record.protocol,
            amount: { cents: record.amount.cents.toString(), currency: record.amount.currency },
            timestamp: record.timestamp.toISOString(),
            txHash: record.txHash,
            network: record.network,
          }),
        );
      }

      // Read with maxRecords=3
      const history = new PaymentHistory({ storage, maxRecords: 3 });
      await history.loadFromStorage();

      expect(history.length).toBe(3);
    });

    it("loadFromStorage with empty storage starts fresh", async () => {
      const storage = new MemoryAdapter();
      const history = new PaymentHistory({ storage, maxRecords: 100 });
      await history.loadFromStorage();

      expect(history.length).toBe(0);
      expect(history.getAll()).toEqual([]);
    });
  });
});
