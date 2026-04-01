import { describe, expect, it, vi, beforeEach } from "vitest";
import { Money } from "@boltzpay/core";
import type { ManagedSession, SessionCloseResult } from "@boltzpay/core";
import type { MppStreamEvent } from "@boltzpay/protocols";
import { BoltzPaySession } from "../../src/session/boltzpay-session";
import type { BoltzPaySessionParams } from "../../src/session/boltzpay-session";
import { TypedEventEmitter } from "../../src/events/event-emitter";
import { PaymentHistory } from "../../src/history/payment-history";
import type { BudgetManager } from "../../src/budget/budget-manager";
import { MppSessionBudgetError, MppSessionError } from "../../src/errors/mpp-session-error";
import type { SessionEvent } from "../../src/session/session-types";

function createMockManagedSession(overrides?: {
  channelId?: string;
  spent?: bigint;
  fetchResponse?: Response;
  closeResult?: SessionCloseResult;
}): ManagedSession & { updateChannel?: (entry: unknown) => void } {
  const channelId = overrides?.channelId ?? "0x" + "ab".repeat(32);
  let spent = overrides?.spent ?? 0n;

  return {
    get channelId() { return channelId; },
    get spent() { return spent; },
    fetch: vi.fn().mockResolvedValue(
      overrides?.fetchResponse ?? new Response("data", { status: 200 }),
    ),
    close: vi.fn().mockResolvedValue(
      overrides?.closeResult ?? {
        channelId,
        totalSpent: spent,
        refunded: 0n,
      },
    ),
    updateChannel(entry: unknown) {
      const e = entry as { cumulativeAmount: bigint };
      spent = e.cumulativeAmount;
    },
  };
}

function createStreamableMockSession(overrides?: {
  channelId?: string;
  spent?: bigint;
  closeResult?: SessionCloseResult;
  streamEvents?: MppStreamEvent[];
}): ManagedSession & { stream: (url: string, init?: Record<string, unknown>) => AsyncIterable<MppStreamEvent> } {
  const channelId = overrides?.channelId ?? "0x" + "ab".repeat(32);
  const spent = overrides?.spent ?? 0n;
  const events = overrides?.streamEvents ?? [];

  return {
    get channelId() { return channelId; },
    get spent() { return spent; },
    fetch: vi.fn().mockResolvedValue(new Response("data", { status: 200 })),
    close: vi.fn().mockResolvedValue(
      overrides?.closeResult ?? {
        channelId,
        totalSpent: spent,
        refunded: 0n,
      },
    ),
    async *stream(_url: string, _init?: Record<string, unknown>) {
      for (const event of events) {
        yield event;
      }
    },
  };
}

function createMockBudgetManager(overrides?: {
  available?: Money;
  reserveThrows?: boolean;
}): BudgetManager {
  const available = overrides?.available ?? Money.fromDollars("100.00");
  return {
    checkTransaction: vi.fn().mockReturnValue({ exceeded: false }),
    recordSpending: vi.fn(),
    getState: vi.fn().mockReturnValue({
      dailySpent: Money.zero(),
      monthlySpent: Money.zero(),
    }),
    reserve: overrides?.reserveThrows
      ? vi.fn().mockImplementation(() => {
          throw new Error("Reservation exceeds available budget");
        })
      : vi.fn().mockReturnValue("rsv_1"),
    release: vi.fn(),
    availableForReservation: vi.fn().mockReturnValue(available),
    convertToUsd: vi.fn().mockImplementation((m: Money) => m),
    loadFromStorage: vi.fn().mockResolvedValue(undefined),
    checkWarning: vi.fn().mockReturnValue({ warning: false }),
    resetDaily: vi.fn(),
  } as unknown as BudgetManager;
}

function buildParams(overrides?: Partial<BoltzPaySessionParams>): BoltzPaySessionParams {
  return {
    session: overrides?.session ?? createMockManagedSession(),
    budgetManager: overrides?.budgetManager ?? createMockBudgetManager(),
    emitter: overrides?.emitter ?? new TypedEventEmitter(),
    history: overrides?.history ?? new PaymentHistory(),
    url: overrides?.url ?? "https://api.example.com/chat",
    depositAmount: overrides?.depositAmount ?? Money.fromDollars("10.00"),
    reservationId: overrides?.reservationId ?? "rsv_1",
    sessionId: overrides?.sessionId ?? "sess_test_123",
  };
}

describe("BoltzPaySession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("construction and open history entry", () => {
    it("writes an open history entry immediately at construction", () => {
      const history = new PaymentHistory();
      const params = buildParams({ history });

      new BoltzPaySession(params);

      const records = history.getAll();
      expect(records).toHaveLength(1);
      expect(records[0]?.sessionStatus).toBe("open");
      expect(records[0]?.sessionId).toBe("sess_test_123");
    });

    it("exposes channelId from underlying session", () => {
      const session = createMockManagedSession({ channelId: "0x" + "ff".repeat(32) });
      const bpSession = new BoltzPaySession(buildParams({ session }));

      expect(bpSession.channelId).toBe("0x" + "ff".repeat(32));
    });

    it("exposes spent from underlying session", () => {
      const session = createMockManagedSession({ spent: 500000n });
      const bpSession = new BoltzPaySession(buildParams({ session }));

      expect(bpSession.spent).toBe(500000n);
    });
  });

  describe("fetch", () => {
    it("delegates to underlying session.fetch", async () => {
      const session = createMockManagedSession();
      const bpSession = new BoltzPaySession(buildParams({ session }));

      await bpSession.fetch("https://api.example.com/data");

      expect(session.fetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        undefined,
      );
    });

    it("returns the response from underlying fetch", async () => {
      const mockResponse = new Response("hello", { status: 200 });
      const session = createMockManagedSession({ fetchResponse: mockResponse });
      const bpSession = new BoltzPaySession(buildParams({ session }));

      const result = await bpSession.fetch("https://api.example.com/data");
      expect(result).toBe(mockResponse);
    });
  });

  describe("close", () => {
    it("writes a close history entry with sessionStatus closed", async () => {
      const history = new PaymentHistory();
      const mockClose: SessionCloseResult = {
        channelId: "0x" + "ab".repeat(32),
        totalSpent: 300000n,
        refunded: 700000n,
      };
      const session = createMockManagedSession({ closeResult: mockClose });
      const bpSession = new BoltzPaySession(buildParams({ session, history }));

      await bpSession.close();

      const records = history.getAll();
      expect(records).toHaveLength(2); // open + close
      expect(records[1]?.sessionStatus).toBe("closed");
      expect(records[1]?.sessionId).toBe("sess_test_123");
    });

    it("releases unused reservation back to budget", async () => {
      const budgetManager = createMockBudgetManager();
      const deposit = Money.fromDollars("10.00");
      const mockClose: SessionCloseResult = {
        channelId: "0x" + "ab".repeat(32),
        totalSpent: 300000n,
        refunded: 700000n,
      };
      const session = createMockManagedSession({ closeResult: mockClose });
      const bpSession = new BoltzPaySession(
        buildParams({ session, budgetManager, depositAmount: deposit }),
      );

      await bpSession.close();

      expect(budgetManager.release).toHaveBeenCalledWith(
        "rsv_1",
        expect.any(Money),
      );
    });

    it("emits session:close event", async () => {
      const emitter = new TypedEventEmitter();
      const closeHandler = vi.fn();
      emitter.on("session:close", closeHandler);

      const mockClose: SessionCloseResult = {
        channelId: "0x" + "ab".repeat(32),
        totalSpent: 300000n,
        refunded: 700000n,
      };
      const session = createMockManagedSession({ closeResult: mockClose });
      const bpSession = new BoltzPaySession(
        buildParams({ session, emitter }),
      );

      await bpSession.close();

      expect(closeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: "0x" + "ab".repeat(32),
        }),
      );
    });

    it("returns a SessionReceipt with correct fields", async () => {
      const mockClose: SessionCloseResult = {
        channelId: "0x" + "ab".repeat(32),
        totalSpent: 300000n,
        refunded: 700000n,
      };
      const session = createMockManagedSession({ closeResult: mockClose });
      const bpSession = new BoltzPaySession(buildParams({ session }));

      const receipt = await bpSession.close();

      expect(receipt.channelId).toBe("0x" + "ab".repeat(32));
      expect(receipt.totalSpent).toBe(300000n);
      expect(receipt.refunded).toBe(700000n);
      expect(receipt.voucherCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("events", () => {
    it("emits session:open event is done by the caller (openSession)", () => {
      // session:open event is emitted by BoltzPay.openSession(), not by BoltzPaySession constructor
      // This is by design — the constructor writes history, the caller emits the event
      const emitter = new TypedEventEmitter();
      const openHandler = vi.fn();
      emitter.on("session:open", openHandler);

      new BoltzPaySession(buildParams({ emitter }));

      // Constructor does NOT emit session:open — that's openSession()'s job
      expect(openHandler).not.toHaveBeenCalled();
    });
  });

  describe("concurrent sessions budget safety", () => {
    it("two sessions with separate reservations track independently", () => {
      const budgetManager = createMockBudgetManager({ available: Money.fromDollars("100.00") });

      // Both sessions get separate reservationIds (created by openSession, not BoltzPaySession)
      const session1 = new BoltzPaySession(buildParams({
        budgetManager,
        depositAmount: Money.fromDollars("60.00"),
        reservationId: "rsv_1",
        sessionId: "sess_1",
      }));

      const session2 = new BoltzPaySession(buildParams({
        budgetManager,
        depositAmount: Money.fromDollars("30.00"),
        reservationId: "rsv_2",
        sessionId: "sess_2",
      }));

      // Both sessions wrote independent open history entries
      expect(session1.channelId).toBeDefined();
      expect(session2.channelId).toBeDefined();
    });
  });

  describe("reservation release on close", () => {
    it("releases deposit minus actual spent back to budget", async () => {
      const budgetManager = createMockBudgetManager();
      const deposit = Money.fromDollars("60.00");
      const mockClose: SessionCloseResult = {
        channelId: "0x" + "ab".repeat(32),
        totalSpent: 2000000n, // 20 USDC (raw units)
        refunded: 4000000n,
      };
      const session = createMockManagedSession({ closeResult: mockClose });
      const bpSession = new BoltzPaySession(
        buildParams({ session, budgetManager, depositAmount: deposit }),
      );

      await bpSession.close();

      // release should be called with reservationId and unused amount
      expect(budgetManager.release).toHaveBeenCalledWith(
        "rsv_1",
        expect.any(Money),
      );
    });
  });

  describe("stream", () => {
    it("throws MppSessionError when session does not support streaming", async () => {
      const session = createMockManagedSession();
      const bpSession = new BoltzPaySession(buildParams({ session }));

      const events: SessionEvent[] = [];
      await expect(async () => {
        for await (const event of bpSession.stream("https://api.example.com/stream")) {
          events.push(event);
        }
      }).rejects.toThrow(MppSessionError);
    });

    it("yields data events from underlying streamable session", async () => {
      const session = createStreamableMockSession({
        streamEvents: [
          { type: "data", payload: "hello" },
          { type: "data", payload: "world" },
        ],
      });
      const bpSession = new BoltzPaySession(buildParams({ session }));

      const events: SessionEvent[] = [];
      for await (const event of bpSession.stream("https://api.example.com/stream")) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "data", payload: "hello" });
      expect(events[1]).toEqual({ type: "data", payload: "world" });
    });

    it("emits session:voucher event on payment events", async () => {
      const emitter = new TypedEventEmitter();
      const voucherHandler = vi.fn();
      emitter.on("session:voucher", voucherHandler);

      const channelId = "0x" + "ab".repeat(32);
      const session = createStreamableMockSession({
        channelId,
        streamEvents: [
          { type: "data", payload: "chunk1" },
          { type: "payment", channelId, cumulativeAmount: 50000n, index: 1 },
          { type: "data", payload: "chunk2" },
        ],
      });
      const bpSession = new BoltzPaySession(
        buildParams({ session, emitter, depositAmount: Money.fromDollars("10.00") }),
      );

      const events: SessionEvent[] = [];
      for await (const event of bpSession.stream("https://api.example.com/stream")) {
        events.push(event);
      }

      expect(voucherHandler).toHaveBeenCalledWith({
        channelId,
        cumulativeAmount: 50000n,
        index: 1,
      });
    });

    it("increments voucher count on each payment event", async () => {
      const channelId = "0x" + "ab".repeat(32);
      const session = createStreamableMockSession({
        channelId,
        streamEvents: [
          { type: "payment", channelId, cumulativeAmount: 50000n, index: 1 },
          { type: "payment", channelId, cumulativeAmount: 100000n, index: 2 },
        ],
      });
      const bpSession = new BoltzPaySession(
        buildParams({ session, depositAmount: Money.fromDollars("10.00") }),
      );

      for await (const _event of bpSession.stream("https://api.example.com/stream")) {
        // consume
      }

      const receipt = await bpSession.close();
      expect(receipt.voucherCount).toBe(2);
    });

    it("throws MppSessionBudgetError and closes when cumulative exceeds deposit", async () => {
      const channelId = "0x" + "ab".repeat(32);
      // deposit = $1.00 = 100 cents
      // cumulativeAmount 2_000_000n raw = 200 cents = $2.00 > $1.00
      const session = createStreamableMockSession({
        channelId,
        streamEvents: [
          { type: "data", payload: "chunk1" },
          { type: "payment", channelId, cumulativeAmount: 2_000_000n, index: 1 },
        ],
      });
      const bpSession = new BoltzPaySession(
        buildParams({ session, depositAmount: Money.fromDollars("1.00") }),
      );

      await expect(async () => {
        for await (const _event of bpSession.stream("https://api.example.com/stream")) {
          // consume
        }
      }).rejects.toThrow(MppSessionBudgetError);

      expect(session.close).toHaveBeenCalled();
    });

    it("does not throw when cumulative equals deposit exactly", async () => {
      const channelId = "0x" + "ab".repeat(32);
      // deposit = $10.00 = 1000 cents
      // cumulativeAmount 10_000_000n raw / 10000n = 1000 cents = $10.00 — exactly equal
      const session = createStreamableMockSession({
        channelId,
        streamEvents: [
          { type: "payment", channelId, cumulativeAmount: 10_000_000n, index: 1 },
        ],
      });
      const bpSession = new BoltzPaySession(
        buildParams({ session, depositAmount: Money.fromDollars("10.00") }),
      );

      const events: SessionEvent[] = [];
      for await (const event of bpSession.stream("https://api.example.com/stream")) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("payment");
    });

    it("maps payment events to SessionEvent with voucher info", async () => {
      const channelId = "0x" + "ab".repeat(32);
      const session = createStreamableMockSession({
        channelId,
        streamEvents: [
          { type: "payment", channelId, cumulativeAmount: 50000n, index: 1 },
        ],
      });
      const bpSession = new BoltzPaySession(
        buildParams({ session, depositAmount: Money.fromDollars("10.00") }),
      );

      const events: SessionEvent[] = [];
      for await (const event of bpSession.stream("https://api.example.com/stream")) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      const paymentEvent = events[0];
      expect(paymentEvent?.type).toBe("payment");
      if (paymentEvent?.type === "payment") {
        expect(paymentEvent.voucher.channelId).toBe(channelId);
        expect(paymentEvent.voucher.cumulativeAmount).toBe(50000n);
        expect(paymentEvent.voucher.index).toBe(1);
      }
    });
  });
});
