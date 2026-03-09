import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import { exportCSV, exportJSON } from "../../src/history/export";
import type { PaymentRecord } from "../../src/history/types";

function makeRecord(
  id: number,
  opts?: { url?: string; durationMs?: number; dollars?: string },
): PaymentRecord {
  return {
    id: `record-${id}`,
    url: opts?.url ?? `https://api.example.com/resource/${id}`,
    protocol: "x402",
    amount: Money.fromDollars(opts?.dollars ?? "1.00"),
    timestamp: new Date("2026-02-18T00:00:00Z"),
    txHash: `0x${id.toString(16).padStart(8, "0")}`,
    network: "base",
    durationMs: opts?.durationMs,
  };
}

describe("exportCSV", () => {
  it("empty records => header row only", () => {
    const csv = exportCSV([]);
    expect(csv).toBe(
      "id,timestamp,url,protocol,amount,amount_cents,currency,network,tx_hash,duration_ms",
    );
  });

  it("one record => header + one data row", () => {
    const csv = exportCSV([makeRecord(1, { durationMs: 450 })]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "id,timestamp,url,protocol,amount,amount_cents,currency,network,tx_hash,duration_ms",
    );
    const fields = lines[1].split(",");
    expect(fields).toHaveLength(10); // same as header
    expect(fields[0]).toBe("record-1");
    expect(fields[9]).toBe("450");
  });

  it("field count matches header count for each row", () => {
    const records = [makeRecord(1), makeRecord(2, { durationMs: 200 })];
    const csv = exportCSV(records);
    const lines = csv.split("\n");
    const headerCount = lines[0].split(",").length;
    for (let i = 1; i < lines.length; i++) {
      // Count fields considering possible quoted fields
      const row = lines[i];
      let fieldCount = 0;
      let inQuotes = false;
      for (let j = 0; j < row.length; j++) {
        if (row[j] === '"') inQuotes = !inQuotes;
        if (row[j] === "," && !inQuotes) fieldCount++;
      }
      fieldCount++; // fields = commas + 1
      expect(fieldCount).toBe(headerCount);
    }
  });

  it("URL with comma is properly escaped in RFC 4180", () => {
    const csv = exportCSV([
      makeRecord(1, { url: "https://api.example.com/a,b" }),
    ]);
    const lines = csv.split("\n");
    // The URL field should be wrapped in double quotes
    expect(lines[1]).toContain('"https://api.example.com/a,b"');
  });

  it("URL with double quote is properly escaped in RFC 4180", () => {
    const csv = exportCSV([
      makeRecord(1, { url: 'https://api.example.com/a"b' }),
    ]);
    const lines = csv.split("\n");
    // Internal quote should be doubled, field wrapped in quotes
    expect(lines[1]).toContain('"https://api.example.com/a""b"');
  });

  it("undefined fields become empty strings", () => {
    const record: PaymentRecord = {
      id: "r1",
      url: "https://example.com",
      protocol: "x402",
      amount: Money.fromDollars("1.00"),
      timestamp: new Date("2026-02-18T00:00:00Z"),
      txHash: undefined,
      network: undefined,
    };
    const csv = exportCSV([record]);
    const lines = csv.split("\n");
    const fields = lines[1].split(",");
    // network (index 7) and tx_hash (index 8) and duration_ms (index 9) should be empty
    expect(fields[7]).toBe("");
    expect(fields[8]).toBe("");
    expect(fields[9]).toBe("");
  });

  it("uses Unix-style newlines", () => {
    const csv = exportCSV([makeRecord(1)]);
    expect(csv).not.toContain("\r\n");
    expect(csv).toContain("\n");
  });
});

describe("exportJSON", () => {
  it("empty records => '[]'", () => {
    const json = exportJSON([]);
    expect(json).toBe("[]");
  });

  it("records serialized with correct field names", () => {
    const record = makeRecord(1, { durationMs: 500, dollars: "2.50" });
    const json = exportJSON([record]);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    const obj = parsed[0];
    expect(obj.id).toBe("record-1");
    expect(obj.timestamp).toBe("2026-02-18T00:00:00.000Z");
    expect(obj.url).toBe("https://api.example.com/resource/1");
    expect(obj.protocol).toBe("x402");
    expect(obj.amount).toBe("$2.50");
    expect(obj.amountCents).toBe("250");
    expect(obj.currency).toBe("USD");
    expect(obj.network).toBe("base");
    expect(obj.txHash).toBe("0x00000001");
    expect(obj.durationMs).toBe(500);
  });

  it("undefined fields become null in JSON", () => {
    const record: PaymentRecord = {
      id: "r1",
      url: "https://example.com",
      protocol: "x402",
      amount: Money.fromDollars("1.00"),
      timestamp: new Date("2026-02-18T00:00:00Z"),
      txHash: undefined,
      network: undefined,
    };
    const json = exportJSON([record]);
    const parsed = JSON.parse(json);
    expect(parsed[0].network).toBeNull();
    expect(parsed[0].txHash).toBeNull();
    expect(parsed[0].durationMs).toBeNull();
  });

  it("output is pretty-printed with 2-space indent", () => {
    const json = exportJSON([makeRecord(1)]);
    // Pretty-printed JSON has newlines and 2-space indentation
    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });

  it("output is valid JSON", () => {
    const json = exportJSON([makeRecord(1), makeRecord(2)]);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });
});
