import { Money } from "@boltzpay/core";
import type { PaymentRecord } from "../history/types";

export interface PaymentMetrics {
  readonly totalSpent: Money;
  readonly callCount: number;
  readonly successCount: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly avgLatencyMs: number;
  readonly lastPaymentAt: Date | undefined;
}

export function computeMetrics(
  records: readonly PaymentRecord[],
  errorCount: number,
): PaymentMetrics {
  const successCount = records.length;
  const callCount = successCount + errorCount;
  const errorRate = callCount > 0 ? errorCount / callCount : 0;

  const totalSpent = records.reduce(
    (acc, r) => acc.add(r.amount),
    Money.zero(),
  );

  const withLatency = records.filter(
    (r): r is PaymentRecord & { durationMs: number } =>
      r.durationMs !== undefined,
  );
  const avgLatencyMs =
    withLatency.length > 0
      ? Math.round(
          withLatency.reduce((sum, r) => sum + r.durationMs, 0) /
            withLatency.length,
        )
      : 0;

  const lastPaymentAt =
    records.length > 0 ? records[records.length - 1].timestamp : undefined;

  return {
    totalSpent,
    callCount,
    successCount,
    errorCount,
    errorRate,
    avgLatencyMs,
    lastPaymentAt,
  };
}
