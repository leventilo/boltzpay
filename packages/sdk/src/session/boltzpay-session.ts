import type { ManagedSession, SessionCloseResult } from "@boltzpay/core";
import { Money } from "@boltzpay/core";
import { isStreamableSession } from "@boltzpay/protocols";
import type { BudgetManager } from "../budget/budget-manager";
import {
  MppSessionBudgetError,
  MppSessionError,
} from "../errors/mpp-session-error";
import { ProtocolError } from "../errors/protocol-error";
import type { TypedEventEmitter } from "../events/event-emitter";
import type { PaymentHistory } from "../history/payment-history";
import type { PaymentRecord } from "../history/types";
import type {
  SessionEvent,
  SessionReceipt,
  VoucherInfo,
} from "./session-types";

export interface BoltzPaySessionParams {
  readonly session: ManagedSession;
  readonly budgetManager: BudgetManager;
  readonly emitter: TypedEventEmitter;
  readonly history: PaymentHistory;
  readonly url: string;
  readonly depositAmount: Money;
  readonly reservationId: string;
  readonly sessionId: string;
}

export class BoltzPaySession {
  private readonly session: ManagedSession;
  private readonly budgetManager: BudgetManager;
  private readonly emitter: TypedEventEmitter;
  private readonly history: PaymentHistory;
  private readonly url: string;
  private readonly depositAmount: Money;
  private readonly reservationId: string;
  private readonly sessionId: string;
  private voucherCount = 0;
  private closePromise: Promise<SessionReceipt> | undefined;

  constructor(params: BoltzPaySessionParams) {
    this.session = params.session;
    this.budgetManager = params.budgetManager;
    this.emitter = params.emitter;
    this.history = params.history;
    this.url = params.url;
    this.depositAmount = params.depositAmount;
    this.reservationId = params.reservationId;
    this.sessionId = params.sessionId;

    this.writeOpenHistoryEntry();
  }

  get channelId(): string {
    return this.session.channelId;
  }

  get spent(): bigint {
    return this.session.spent;
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    // Cast justified: init is narrowed from RequestInit to the generic Record
    // expected by ManagedSession.fetch, which is implemented by mppx externally
    const response = await this.session.fetch(
      url,
      init as Record<string, unknown>,
    );

    // Runtime check: mppx is external — verify the returned value is Response-shaped
    this.assertValidResponse(response);

    return response;
  }

  private assertValidResponse(value: Response): void {
    const raw: unknown = value;
    const isResponseShaped =
      raw !== null &&
      typeof raw === "object" &&
      typeof (raw as Record<string, unknown>).status === "number" &&
      typeof (raw as Record<string, unknown>).ok === "boolean";
    if (!isResponseShaped) {
      throw new ProtocolError(
        "payment_failed",
        "Session fetch returned an invalid response object",
      );
    }
  }

  async close(): Promise<SessionReceipt> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<SessionReceipt> {
    const result: SessionCloseResult = await this.session.close();

    const spentMoney = this.convertRawToMoney(result.totalSpent);
    const unused = this.depositAmount.greaterThanOrEqual(spentMoney)
      ? this.depositAmount.subtract(spentMoney)
      : Money.zero();
    this.budgetManager.release(this.reservationId, unused);

    this.writeCloseHistoryEntry(result);

    this.emitter.emit("session:close", {
      channelId: result.channelId,
      totalSpent: result.totalSpent,
      refunded: result.refunded,
    });

    return {
      channelId: result.channelId,
      totalSpent: result.totalSpent,
      refunded: result.refunded,
      voucherCount: this.voucherCount,
    };
  }

  async *stream(
    url: string,
    init?: Record<string, unknown>,
  ): AsyncIterable<SessionEvent> {
    if (!isStreamableSession(this.session)) {
      throw new MppSessionError("Session does not support streaming");
    }

    for await (const event of this.session.stream(url, init)) {
      if (event.type === "data") {
        yield { type: "data", payload: event.payload };
        continue;
      }

      const voucher: VoucherInfo = {
        channelId: event.channelId,
        cumulativeAmount: event.cumulativeAmount,
        index: event.index,
      };

      this.incrementVoucherCount();

      this.emitter.emit("session:voucher", {
        channelId: voucher.channelId,
        cumulativeAmount: voucher.cumulativeAmount,
        index: voucher.index,
      });

      const spentMoney = this.convertRawToMoney(voucher.cumulativeAmount);
      if (spentMoney.greaterThan(this.depositAmount)) {
        await this.close();
        throw new MppSessionBudgetError(spentMoney, this.depositAmount);
      }

      yield { type: "payment", voucher };
    }
  }

  private incrementVoucherCount(): void {
    this.voucherCount++;
  }

  private writeOpenHistoryEntry(): void {
    const record: PaymentRecord = {
      id: crypto.randomUUID(),
      url: this.url,
      protocol: "mpp",
      amount: this.depositAmount,
      timestamp: new Date(),
      txHash: undefined,
      network: "tempo",
      sessionId: this.sessionId,
      sessionStatus: "open",
    };
    this.history.add(record);
  }

  private writeCloseHistoryEntry(result: SessionCloseResult): void {
    const spentMoney = this.convertRawToMoney(result.totalSpent);
    const record: PaymentRecord = {
      id: crypto.randomUUID(),
      url: this.url,
      protocol: "mpp",
      amount: spentMoney,
      timestamp: new Date(),
      txHash: undefined,
      network: "tempo",
      sessionId: this.sessionId,
      sessionStatus: "closed",
    };
    this.history.add(record);
  }

  private convertRawToMoney(rawAmount: bigint): Money {
    // Convert raw USDC atomic units to USD cents: 1 USDC = 1_000_000 raw = 100 cents
    const USDC_DECIMALS_TO_CENTS = 10000n; // 1_000_000 / 100
    const cents = rawAmount / USDC_DECIMALS_TO_CENTS;
    return Money.fromCents(cents);
  }
}
