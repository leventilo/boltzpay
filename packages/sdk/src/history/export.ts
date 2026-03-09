import type { PaymentRecord } from "./types";

const CSV_HEADER =
  "id,timestamp,url,protocol,amount,amount_cents,currency,network,tx_hash,duration_ms";

function escapeCSV(field: unknown): string {
  const str = field === undefined || field === null ? "" : String(field);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\r") ||
    str.includes("\n")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportCSV(records: readonly PaymentRecord[]): string {
  if (records.length === 0) return CSV_HEADER;

  const rows = records.map((r) =>
    [
      r.id,
      r.timestamp.toISOString(),
      r.url,
      r.protocol,
      r.amount.toDisplayString(),
      r.amount.cents.toString(),
      r.amount.currency,
      r.network ?? "",
      r.txHash ?? "",
      r.durationMs?.toString() ?? "",
    ]
      .map(escapeCSV)
      .join(","),
  );

  return CSV_HEADER + "\n" + rows.join("\n");
}

export function exportJSON(records: readonly PaymentRecord[]): string {
  const mapped = records.map((r) => ({
    id: r.id,
    timestamp: r.timestamp.toISOString(),
    url: r.url,
    protocol: r.protocol,
    amount: r.amount.toDisplayString(),
    amountCents: r.amount.cents.toString(),
    currency: r.amount.currency,
    network: r.network ?? null,
    txHash: r.txHash ?? null,
    durationMs: r.durationMs ?? null,
  }));

  return JSON.stringify(mapped, null, 2);
}
