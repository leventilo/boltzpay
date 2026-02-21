import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Money } from "@boltzpay/core";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentHistory } from "../src/history/payment-history";
import type { PaymentRecord } from "../src/history/types";

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

function tmpFilePath(suffix: string): string {
  return join(tmpdir(), `boltzpay-test-history-${Date.now()}-${suffix}.jsonl`);
}

describe("PaymentHistory — persistence", () => {
  const filesToClean: string[] = [];

  afterEach(() => {
    for (const f of filesToClean) {
      if (existsSync(f)) {
        unlinkSync(f);
      }
    }
    filesToClean.length = 0;
  });

  it("in-memory mode (no persistence) works without any file I/O", () => {
    const history = new PaymentHistory();
    history.add(makeRecord(1));
    history.add(makeRecord(2));

    expect(history.length).toBe(2);
    expect(history.getAll()[0].id).toBe("record-1");
    expect(history.getAll()[1].id).toBe("record-2");
  });

  it("persistence creates file and appends records as JSONL", () => {
    const filePath = tmpFilePath("create");
    filesToClean.push(filePath);

    const history = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    history.add(makeRecord(1));
    history.add(makeRecord(2));

    expect(existsSync(filePath)).toBe(true);

    const lines = readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(2);

    const parsed = JSON.parse(lines[0]) as { id: string };
    expect(parsed.id).toBe("record-1");
  });

  it("loads records from existing file on construction", () => {
    const filePath = tmpFilePath("load");
    filesToClean.push(filePath);

    const first = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    first.add(makeRecord(10));
    first.add(makeRecord(20));

    const second = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    expect(second.length).toBe(2);
    expect(second.getAll()[0].id).toBe("record-10");
    expect(second.getAll()[1].id).toBe("record-20");
  });

  it("corrupt lines in file are skipped gracefully", () => {
    const filePath = tmpFilePath("corrupt");
    filesToClean.push(filePath);

    const validRecord = JSON.stringify({
      id: "good-1",
      url: "https://example.com/1",
      protocol: "x402",
      amount: { cents: "150", currency: "USD" },
      timestamp: "2026-02-18T12:00:00.000Z",
      txHash: "0x01",
      network: "base",
    });
    const content = `${validRecord}\n{{{CORRUPT JSON\nnot-even-json\n`;
    writeFileSync(filePath, content, "utf-8");

    const history = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });

    expect(history.length).toBe(1);
    expect(history.getAll()[0].id).toBe("good-1");
  });

  it("empty file loads cleanly with zero records", () => {
    const filePath = tmpFilePath("empty");
    filesToClean.push(filePath);

    writeFileSync(filePath, "", "utf-8");

    const history = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    expect(history.length).toBe(0);
    expect(history.getAll()).toEqual([]);
  });

  it("Money serialization roundtrip preserves cents and currency (USD)", () => {
    const filePath = tmpFilePath("roundtrip-usd");
    filesToClean.push(filePath);

    const history = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    history.add(makeRecord(1));

    const loaded = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    const record = loaded.getAll()[0];

    expect(record.amount.cents).toBe(150n);
    expect(record.amount.currency).toBe("USD");
    expect(record.amount.equals(Money.fromDollars("1.50"))).toBe(true);
  });

  it("Money serialization roundtrip preserves SATS currency", () => {
    const filePath = tmpFilePath("roundtrip-sats");
    filesToClean.push(filePath);

    const history = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    history.add(makeSatsRecord(1));

    const loaded = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    const record = loaded.getAll()[0];

    expect(record.amount.cents).toBe(500n);
    expect(record.amount.currency).toBe("SATS");
    expect(record.amount.equals(Money.fromSatoshis(500n))).toBe(true);
  });

  it("max records rotation truncates file to maxRecords", () => {
    const filePath = tmpFilePath("rotation");
    filesToClean.push(filePath);

    const history = new PaymentHistory({
      persistence: { filePath, maxRecords: 3 },
    });

    history.add(makeRecord(1));
    history.add(makeRecord(2));
    history.add(makeRecord(3));
    history.add(makeRecord(4));

    expect(history.length).toBe(3);

    const lines = readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(3);

    const ids = lines.map((l) => (JSON.parse(l) as { id: string }).id);
    expect(ids).toEqual(["record-2", "record-3", "record-4"]);
  });

  it("records loaded from file are correct Money instances (instanceof)", () => {
    const filePath = tmpFilePath("money-instance");
    filesToClean.push(filePath);

    const history = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    history.add(makeRecord(1));

    const loaded = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    const record = loaded.getAll()[0];

    expect(record.amount.toDisplayString()).toBe("$1.50");
    expect(record.amount.isZero()).toBe(false);
    expect(record.amount.add(Money.fromCents(50n)).cents).toBe(200n);
  });

  it("multiple adds persist correctly across reloads", () => {
    const filePath = tmpFilePath("multi-add");
    filesToClean.push(filePath);

    const history = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    history.add(makeRecord(1));
    history.add(makeSatsRecord(2));
    history.add(makeRecord(3));

    const loaded = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    expect(loaded.length).toBe(3);

    const all = loaded.getAll();
    expect(all[0].id).toBe("record-1");
    expect(all[0].protocol).toBe("x402");
    expect(all[1].id).toBe("sats-2");
    expect(all[1].protocol).toBe("L402");
    expect(all[2].id).toBe("record-3");
    expect(all[2].timestamp).toBeInstanceOf(Date);
  });

  it("file with excess records is truncated on load to maxRecords", () => {
    const filePath = tmpFilePath("excess");
    filesToClean.push(filePath);

    const writer = new PaymentHistory({
      persistence: { filePath, maxRecords: 100 },
    });
    for (let i = 0; i < 10; i++) {
      writer.add(makeRecord(i));
    }

    const reader = new PaymentHistory({
      persistence: { filePath, maxRecords: 5 },
    });
    expect(reader.length).toBe(5);

    const all = reader.getAll();
    expect(all[0].id).toBe("record-5");
    expect(all[4].id).toBe("record-9");
  });

  it("record fields including txHash/network undefined survive roundtrip", () => {
    const filePath = tmpFilePath("optional-fields");
    filesToClean.push(filePath);

    const history = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    history.add(makeSatsRecord(1));

    const loaded = new PaymentHistory({
      persistence: { filePath, maxRecords: 50 },
    });
    const record = loaded.getAll()[0];

    expect(record.txHash).toBeUndefined();
    expect(record.network).toBeUndefined();
    expect(record.url).toBe("https://lnpay.example.com/1");
  });
});
