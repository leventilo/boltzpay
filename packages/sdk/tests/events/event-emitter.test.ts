import { Money } from "@boltzpay/core";
import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "../../src/events/event-emitter";
import type { PaymentRecord } from "../../src/history/types";

function makePaymentRecord(): PaymentRecord {
  return {
    id: "test-id-1",
    url: "https://api.example.com/data",
    protocol: "x402",
    amount: Money.fromDollars("1.00"),
    timestamp: new Date("2026-02-18T00:00:00Z"),
    txHash: "0xabc123",
    network: "base",
  };
}

describe("TypedEventEmitter", () => {
  it("payment event fires with PaymentRecord", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    emitter.on("payment", listener);

    const record = makePaymentRecord();
    emitter.emit("payment", record);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(record);
  });

  it("budget:warning event fires with BudgetWarningEvent", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    emitter.on("budget:warning", listener);

    const event = {
      spent: Money.fromDollars("80.00"),
      limit: Money.fromDollars("100.00"),
      period: "daily" as const,
      usage: 0.8,
    };
    emitter.emit("budget:warning", event);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("budget:exceeded event fires with BudgetExceededEvent", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    emitter.on("budget:exceeded", listener);

    const event = {
      requested: Money.fromDollars("50.00"),
      limit: Money.fromDollars("20.00"),
      period: "daily" as const,
    };
    emitter.emit("budget:exceeded", event);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("error event fires with Error", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    emitter.on("error", listener);

    const err = new Error("test error");
    emitter.emit("error", err);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(err);
  });

  it("on() registers listener, emit() triggers it", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    emitter.on("payment", listener);

    emitter.emit("payment", makePaymentRecord());
    expect(listener).toHaveBeenCalledOnce();
  });

  it("off() removes listener so it no longer fires", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    emitter.on("payment", listener);
    emitter.off("payment", listener);

    emitter.emit("payment", makePaymentRecord());
    expect(listener).not.toHaveBeenCalled();
  });

  it("multiple listeners on same event all fire", () => {
    const emitter = new TypedEventEmitter();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    emitter.on("payment", listener1);
    emitter.on("payment", listener2);

    emitter.emit("payment", makePaymentRecord());
    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it("removeAllListeners() clears everything", () => {
    const emitter = new TypedEventEmitter();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    emitter.on("payment", listener1);
    emitter.on("budget:warning", listener2);

    emitter.removeAllListeners();

    emitter.emit("payment", makePaymentRecord());
    // Note: We use budget:warning instead of error here because Node.js
    // EventEmitter throws unhandled "error" events when no listener is attached.
    emitter.emit("budget:warning", {
      spent: Money.fromDollars("80.00"),
      limit: Money.fromDollars("100.00"),
      period: "daily" as const,
      usage: 0.8,
    });
    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).not.toHaveBeenCalled();
  });

  it("emit with no listeners returns false", () => {
    const emitter = new TypedEventEmitter();
    const result = emitter.emit("payment", makePaymentRecord());
    expect(result).toBe(false);
  });

  it("listener receives correct typed args", () => {
    const emitter = new TypedEventEmitter();
    let capturedRecord: PaymentRecord | undefined;
    emitter.on("payment", (record) => {
      capturedRecord = record;
    });

    const record = makePaymentRecord();
    emitter.emit("payment", record);

    expect(capturedRecord).toBeDefined();
    expect(capturedRecord!.id).toBe("test-id-1");
    expect(capturedRecord!.protocol).toBe("x402");
    expect(capturedRecord!.amount.equals(Money.fromDollars("1.00"))).toBe(true);
  });
});
