import { Money } from "@boltzpay/core";
import { appendLine, readLines, writeLines } from "../persistence/storage";
import type { PaymentRecord } from "./types";

const DEFAULT_MAX_SIZE = 100;

interface PersistenceConfig {
  readonly filePath: string;
  readonly maxRecords: number;
}

interface SerializedRecord {
  readonly id: string;
  readonly url: string;
  readonly protocol: string;
  readonly amount: { cents: string; currency: string };
  readonly timestamp: string;
  readonly txHash: string | undefined;
  readonly network: string | undefined;
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
  };
  return JSON.stringify(data);
}

function deserializeRecord(line: string): PaymentRecord | undefined {
  try {
    const data = JSON.parse(line) as SerializedRecord;
    return {
      id: data.id,
      url: data.url,
      protocol: data.protocol,
      amount: Money.fromJSON(data.amount),
      timestamp: new Date(data.timestamp),
      txHash: data.txHash,
      network: data.network,
    };
  } catch {
    // Corrupt line — skip gracefully
    return undefined;
  }
}

export class PaymentHistory {
  private records: PaymentRecord[] = [];
  private readonly maxSize: number;
  private readonly persistence: PersistenceConfig | undefined;

  constructor(options?: { persistence?: PersistenceConfig }) {
    this.persistence = options?.persistence;
    this.maxSize = this.persistence?.maxRecords ?? DEFAULT_MAX_SIZE;

    if (this.persistence) {
      this.loadFromFile(this.persistence.filePath);
    }
  }

  add(record: PaymentRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxSize) {
      this.records = this.records.slice(-this.maxSize);
      this.rotateFile();
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

  private loadFromFile(filePath: string): void {
    const lines = readLines(filePath);
    for (const line of lines) {
      const record = deserializeRecord(line);
      if (record) {
        this.records.push(record);
      }
    }
    if (this.records.length > this.maxSize) {
      this.records = this.records.slice(-this.maxSize);
    }
  }

  private persistRecord(record: PaymentRecord): void {
    if (!this.persistence) return;
    appendLine(this.persistence.filePath, serializeRecord(record));
  }

  private rotateFile(): void {
    if (!this.persistence) return;
    const lines = this.records.map(serializeRecord);
    writeLines(this.persistence.filePath, lines);
  }
}
