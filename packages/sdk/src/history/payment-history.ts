import { Money } from "@boltzpay/core";
import type { StorageAdapter } from "../persistence/storage-adapter";
import type { PaymentRecord } from "./types";

const DEFAULT_MAX_RECORDS = 1000;
const HISTORY_KEY_PREFIX = "history:";

interface SerializedRecord {
  readonly id: string;
  readonly url: string;
  readonly protocol: string;
  readonly amount: { cents: string; currency: string };
  readonly timestamp: string;
  readonly txHash: string | undefined;
  readonly network: string | undefined;
  readonly durationMs?: number;
}

function serializeRecord(record: PaymentRecord): string {
  const data: SerializedRecord = {
    id: record.id,
    url: record.url,
    protocol: record.protocol,
    amount: {
      cents: record.amount.cents.toString(),
      currency: record.amount.currency,
    },
    timestamp: record.timestamp.toISOString(),
    txHash: record.txHash,
    network: record.network,
    durationMs: record.durationMs,
  };
  return JSON.stringify(data);
}

function isSerializedRecord(value: unknown): value is SerializedRecord {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== "string") return false;
  if (typeof obj.url !== "string") return false;
  if (typeof obj.protocol !== "string") return false;
  if (typeof obj.timestamp !== "string") return false;

  const amount = obj.amount;
  if (typeof amount !== "object" || amount === null) return false;
  const amountObj = amount as Record<string, unknown>;
  if (typeof amountObj.cents !== "string") return false;
  if (typeof amountObj.currency !== "string") return false;

  return true;
}

function deserializeRecord(raw: string): PaymentRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isSerializedRecord(parsed)) return undefined;
    return {
      id: parsed.id,
      url: parsed.url,
      protocol: parsed.protocol,
      amount: Money.fromJSON(parsed.amount),
      timestamp: new Date(parsed.timestamp),
      txHash: parsed.txHash,
      network: parsed.network,
      durationMs: parsed.durationMs,
    };
  } catch {
    // Intent: corrupted history line is silently skipped — partial history is acceptable
    return undefined;
  }
}

export class PaymentHistory {
  private records: PaymentRecord[] = [];
  private readonly maxSize: number;
  private readonly storage: StorageAdapter | undefined;

  constructor(options?: {
    storage?: StorageAdapter;
    maxRecords?: number;
  }) {
    this.storage = options?.storage;
    this.maxSize = options?.maxRecords ?? DEFAULT_MAX_RECORDS;
  }

  async loadFromStorage(): Promise<void> {
    if (!this.storage) return;

    const keys = await this.storage.keys(HISTORY_KEY_PREFIX);
    const records: PaymentRecord[] = [];
    for (const key of keys) {
      const raw = await this.storage.get(key);
      if (!raw) continue;
      const record = deserializeRecord(raw);
      if (record) {
        records.push(record);
      }
    }

    records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (records.length > this.maxSize) {
      this.records = records.slice(-this.maxSize);
    } else {
      this.records = records;
    }
  }

  add(record: PaymentRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxSize) {
      const evicted = this.records.splice(
        0,
        this.records.length - this.maxSize,
      );
      this.persistRecord(record);
      this.deleteOldRecords(evicted.map((r) => r.id));
    } else {
      this.persistRecord(record);
    }
  }

  getAll(): readonly PaymentRecord[] {
    return [...this.records];
  }

  get length(): number {
    return this.records.length;
  }

  private persistRecord(record: PaymentRecord): void {
    if (!this.storage) return;
    this.storage
      .set(`${HISTORY_KEY_PREFIX}${record.id}`, serializeRecord(record))
      .catch(() => {});
  }

  private deleteOldRecords(ids: string[]): void {
    if (!this.storage) return;
    for (const id of ids) {
      this.storage.delete(`${HISTORY_KEY_PREFIX}${id}`).catch(() => {});
    }
  }
}
