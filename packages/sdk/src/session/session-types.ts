export type SessionEvent =
  | { readonly type: "data"; readonly payload: string }
  | { readonly type: "payment"; readonly voucher: VoucherInfo };

export interface VoucherInfo {
  readonly channelId: string;
  readonly cumulativeAmount: bigint;
  readonly index: number;
}

export interface SessionReceipt {
  readonly channelId: string;
  readonly totalSpent: bigint;
  readonly refunded: bigint;
  readonly voucherCount: number;
}

export interface BoltzPaySessionOptions {
  readonly maxDeposit?: number | string;
  readonly signal?: AbortSignal;
}
