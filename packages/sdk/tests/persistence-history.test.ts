import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import { PaymentHistory } from "../src/history/payment-history";
import type { PaymentRecord } from "../src/history/types";
import { MemoryAdapter } from "../src/persistence/memory-adapter";

function makeRecord(id: number, protocol = "x402"): PaymentRecord {
  return {
    id: `record-${id}`,
    url: `https://api.example.com/resource/${id}`,
    protocol,
    amount: Money.fromDollars("1.50"),
    timestamp: new Date(
      `2026-02-18T12:00:${String(id % 60).padStart(2, "0")}Z`,
    ),
    txHash: `0x${id.toString(16).padStart(8, "0")}`,
    network: "base",
  };
}

function makeSatsRecord(id: number): PaymentRecord {
  return {
    id: `sats-${id}`,
    url: `https://lnpay.example.com/${id}`,
    protocol: "L402",
    amount: Money.fromSatoshis(500n),
    timestamp: new Date(
      `2026-02-19T08:30:${String(id % 60).padStart(2, "0")}Z`,
    ),
    txHash: undefined,
    network: undefined,
  };
}

describe("PaymentHistory — persistence", () => {
  it("in-memory mode (no storage) works without any persistence", () => {
    const history = new PaymentHistory();
    history.add(makeRecord(1));
    history.add(makeRecord(2));

    expect(history.length).toBe(2);
    expect(history.getAll()[0].id).toBe("record-1");
    expect(history.getAll()[1].id).toBe("record-2");
  });

  it("storage persists records as individual keys", async () => {
    const storage = new MemoryAdapter();
    const history = new PaymentHistory({ storage, maxRecords: 50 });
    history.add(makeRecord(1));
    history.add(makeRecord(2));

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const keys = await storage.keys("history:");
    expect(keys).toHaveLength(2);

    const raw = await storage.get("history:record-1");
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as { id: string };
    expect(parsed.id).toBe("record-1");
  });

  it("loads records from existing storage on loadFromStorage", async () => {
    const storage = new MemoryAdapter();
    const first = new PaymentHistory({ storage, maxRecords: 50 });
    first.add(makeRecord(10));
    first.add(makeRecord(20));

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const second = new PaymentHistory({ storage, maxRecords: 50 });
    await second.loadFromStorage();
    expect(second.length).toBe(2);
    expect(second.getAll()[0].id).toBe("record-10");
    expect(second.getAll()[1].id).toBe("record-20");
  });

  it("corrupt data in storage is skipped gracefully", async () => {
    const storage = new MemoryAdapter();
    await storage.set("history:good-1", JSON.stringify({
      id: "good-1",
      url: "https://example.com/1",
      protocol: "x402",
      amount: { cents: "150", currency: "USD" },
      timestamp: "2026-02-18T12:00:00.000Z",
      txHash: "0x01",
      network: "base",
    }));
    await storage.set("history:corrupt-1", "{{{CORRUPT JSON");

    const history = new PaymentHistory({ storage, maxRecords: 50 });
    await history.loadFromStorage();

    expect(history.length).toBe(1);
    expect(history.getAll()[0].id).toBe("good-1");
  });

  it("empty storage loads cleanly with zero records", async () => {
    const storage = new MemoryAdapter();
    const history = new PaymentHistory({ storage, maxRecords: 50 });
    await history.loadFromStorage();

    expect(history.length).toBe(0);
    expect(history.getAll()).toEqual([]);
  });

  it("money serialization roundtrip preserves cents and currency (USD)", async () => {
    const storage = new MemoryAdapter();
    const history = new PaymentHistory({ storage, maxRecords: 50 });
    history.add(makeRecord(1));

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const loaded = new PaymentHistory({ storage, maxRecords: 50 });
    await loaded.loadFromStorage();
    const record = loaded.getAll()[0];

    expect(record.amount.cents).toBe(150n);
    expect(record.amount.currency).toBe("USD");
    expect(record.amount.equals(Money.fromDollars("1.50"))).toBe(true);
  });

  it("money serialization roundtrip preserves SATS currency", async () => {
    const storage = new MemoryAdapter();
    const history = new PaymentHistory({ storage, maxRecords: 50 });
    history.add(makeSatsRecord(1));

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const loaded = new PaymentHistory({ storage, maxRecords: 50 });
    await loaded.loadFromStorage();
    const record = loaded.getAll()[0];

    expect(record.amount.cents).toBe(500n);
    expect(record.amount.currency).toBe("SATS");
    expect(record.amount.equals(Money.fromSatoshis(500n))).toBe(true);
  });

  it("max records rotation deletes old keys from storage", async () => {
    const storage = new MemoryAdapter();
    const history = new PaymentHistory({ storage, maxRecords: 3 });

    history.add(makeRecord(1));
    history.add(makeRecord(2));
    history.add(makeRecord(3));
    history.add(makeRecord(4));

    expect(history.length).toBe(3);

    // Wait for fire-and-forget persist and delete
    await new Promise((r) => setTimeout(r, 50));

    // record-1 should be deleted from storage
    const deleted = await storage.get("history:record-1");
    expect(deleted).toBeUndefined();

    // remaining records should exist
    const kept = await storage.get("history:record-4");
    expect(kept).toBeDefined();

    const keys = await storage.keys("history:");
    expect(keys).toHaveLength(3);
  });

  it("records loaded from storage are correct money instances", async () => {
    const storage = new MemoryAdapter();
    const history = new PaymentHistory({ storage, maxRecords: 50 });
    history.add(makeRecord(1));

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const loaded = new PaymentHistory({ storage, maxRecords: 50 });
    await loaded.loadFromStorage();
    const record = loaded.getAll()[0];

    expect(record.amount.toDisplayString()).toBe("$1.50");
    expect(record.amount.isZero()).toBe(false);
    expect(record.amount.add(Money.fromCents(50n)).cents).toBe(200n);
  });

  it("multiple adds persist correctly across reloads", async () => {
    const storage = new MemoryAdapter();
    const history = new PaymentHistory({ storage, maxRecords: 50 });
    history.add(makeRecord(1));
    history.add(makeSatsRecord(2));
    history.add(makeRecord(3));

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const loaded = new PaymentHistory({ storage, maxRecords: 50 });
    await loaded.loadFromStorage();
    expect(loaded.length).toBe(3);

    // Records are sorted by timestamp on load
    const all = loaded.getAll();
    const ids = all.map((r) => r.id).sort();
    expect(ids).toContain("record-1");
    expect(ids).toContain("sats-2");
    expect(ids).toContain("record-3");

    // All records have valid timestamps
    for (const r of all) {
      expect(r.timestamp).toBeInstanceOf(Date);
    }

    // Verify protocol types are preserved
    const x402Records = all.filter((r) => r.protocol === "x402");
    const l402Records = all.filter((r) => r.protocol === "L402");
    expect(x402Records).toHaveLength(2);
    expect(l402Records).toHaveLength(1);
  });

  it("storage with excess records trims on load to maxRecords", async () => {
    const storage = new MemoryAdapter();
    const writer = new PaymentHistory({ storage, maxRecords: 100 });
    for (let i = 0; i < 10; i++) {
      writer.add(makeRecord(i));
    }

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const reader = new PaymentHistory({ storage, maxRecords: 5 });
    await reader.loadFromStorage();
    expect(reader.length).toBe(5);
  });

  it("record fields including txHash/network undefined survive roundtrip", async () => {
    const storage = new MemoryAdapter();
    const history = new PaymentHistory({ storage, maxRecords: 50 });
    history.add(makeSatsRecord(1));

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const loaded = new PaymentHistory({ storage, maxRecords: 50 });
    await loaded.loadFromStorage();
    const record = loaded.getAll()[0];

    expect(record.txHash).toBeUndefined();
    expect(record.network).toBeUndefined();
    expect(record.url).toBe("https://lnpay.example.com/1");
  });

  it("durationMs field survives roundtrip through storage", async () => {
    const storage = new MemoryAdapter();
    const history = new PaymentHistory({ storage, maxRecords: 50 });
    history.add({
      ...makeRecord(1),
      durationMs: 750,
    });

    // Wait for fire-and-forget persist
    await new Promise((r) => setTimeout(r, 10));

    const loaded = new PaymentHistory({ storage, maxRecords: 50 });
    await loaded.loadFromStorage();
    const record = loaded.getAll()[0];

    expect(record.durationMs).toBe(750);
  });
});
