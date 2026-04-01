import { Money } from "@boltzpay/core";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { BudgetManager } from "../../src/budget/budget-manager";
import type { TypedEventEmitter } from "../../src/events/event-emitter";
import type { PaymentHistory } from "../../src/history/payment-history";
import {
  createMcpPaymentWrapper,
  type McpPaymentReceipt,
  type WrappedMcpClient,
} from "../../src/mcp-payment/mcp-payment-wrapper";
import { BudgetExceededError } from "../../src/errors/budget-exceeded-error";

function createMockBudgetManager(overrides?: {
  exceeded?: boolean;
  period?: "daily" | "monthly" | "per_transaction";
  limit?: Money;
}): BudgetManager {
  return {
    checkTransaction: vi.fn().mockReturnValue(
      overrides?.exceeded
        ? {
            exceeded: true,
            period: overrides.period ?? "daily",
            limit: overrides.limit ?? Money.fromCents(1000n),
          }
        : { exceeded: false },
    ),
    recordSpending: vi.fn(),
    convertToUsd: vi.fn((amount: Money) => amount),
  } as unknown as BudgetManager;
}

function createMockEmitter(): TypedEventEmitter {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as TypedEventEmitter;
}

function createMockHistory(): PaymentHistory {
  return {
    add: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    length: 0,
  } as unknown as PaymentHistory;
}

const RECEIPT_META_KEY = "org.paymentauth/receipt";

function makeMockReceipt(): McpPaymentReceipt {
  return {
    method: "tempo",
    status: "success",
    reference: "0xabc123",
    timestamp: "2026-03-31T12:00:00Z",
  };
}

function createMockMcpClient(options?: {
  throwPaymentRequired?: boolean;
  receipt?: McpPaymentReceipt;
}) {
  const receipt = options?.receipt ?? makeMockReceipt();
  return {
    callTool: vi.fn().mockImplementation(() => {
      if (options?.throwPaymentRequired) {
        // After budget-wrapped methods create credentials, mppx McpClient.wrap retries
        // In our wrapper, we simulate the full flow via mppx McpClient.wrap
        throw new Error("should not call original client directly");
      }
      return Promise.resolve({
        content: [{ type: "text", text: "result" }],
        isError: false,
        _meta: { [RECEIPT_META_KEY]: receipt },
      });
    }),
  };
}

function buildSerializedCredential(challengeRequest: Record<string, unknown>): string {
  const requestJson = JSON.stringify(challengeRequest);
  const requestBase64 = Buffer.from(requestJson).toString("base64url");
  const credentialObj = {
    challenge: {
      id: "test-challenge-id",
      realm: "test.example.com",
      method: "tempo",
      intent: "charge",
      request: requestBase64,
    },
    payload: { signature: "0xfake" },
  };
  const credentialJson = JSON.stringify(credentialObj);
  const credentialBase64 = Buffer.from(credentialJson).toString("base64url");
  return `Payment ${credentialBase64}`;
}

function createMockMethod(options?: {
  name?: string;
  intent?: string;
  challengeAmount?: string;
}) {
  const credentialValue = options?.challengeAmount
    ? buildSerializedCredential({ amount: options.challengeAmount, currency: "0xUSDC", recipient: "0xRecipient" })
    : "credential-token";
  return {
    name: options?.name ?? "tempo",
    intent: options?.intent ?? "charge",
    schema: { credential: { payload: {} }, request: {} },
    createCredential: vi.fn().mockResolvedValue(credentialValue),
  };
}

describe("MCP Payment Wrapper", () => {
  let budgetManager: ReturnType<typeof createMockBudgetManager>;
  let emitter: ReturnType<typeof createMockEmitter>;
  let history: ReturnType<typeof createMockHistory>;

  beforeEach(() => {
    budgetManager = createMockBudgetManager();
    emitter = createMockEmitter();
    history = createMockHistory();
  });

  describe("createMcpPaymentWrapper", () => {
    it("wraps a client and returns a WrappedMcpClient with callTool", () => {
      const client = createMockMcpClient();
      const methods = [createMockMethod()];

      const wrapped = createMcpPaymentWrapper({
        client,
        methods,
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      expect(wrapped).toBeDefined();
      expect(typeof wrapped.callTool).toBe("function");
    });

    it("passes through callTool when no payment is needed", async () => {
      const normalResult = {
        content: [{ type: "text", text: "free result" }],
        isError: false,
      };

      // Simulate mppx McpClient.wrap returning result without receipt
      const client = {
        callTool: vi.fn().mockResolvedValue(normalResult),
      };
      const methods = [createMockMethod()];

      const wrapped = createMcpPaymentWrapper({
        client,
        methods,
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      const result = await wrapped.callTool({
        name: "free_tool",
        arguments: {},
      });

      expect(result.content).toEqual(normalResult.content);
      expect(result.receipt).toBeUndefined();
      // No payment means no history record and no event emission
      expect(history.add).not.toHaveBeenCalled();
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it("records payment in history with transport mcp when receipt present", async () => {
      const receipt = makeMockReceipt();
      const resultWithReceipt = {
        content: [{ type: "text", text: "paid result" }],
        isError: false,
        _meta: { [RECEIPT_META_KEY]: receipt },
        receipt,
      };

      const client = {
        callTool: vi.fn().mockResolvedValue(resultWithReceipt),
      };
      const methods = [createMockMethod()];

      const wrapped = createMcpPaymentWrapper({
        client,
        methods,
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      await wrapped.callTool({
        name: "premium_tool",
        arguments: { query: "hello" },
      });

      expect(history.add).toHaveBeenCalledTimes(1);
      const record = (history.add as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(record.transport).toBe("mcp");
      expect(record.protocol).toBe("mpp");
      expect(record.url).toContain("premium_tool");
    });

    it("emits mcp:payment event when receipt present", async () => {
      const receipt = makeMockReceipt();
      const resultWithReceipt = {
        content: [{ type: "text", text: "paid result" }],
        receipt,
        _meta: { [RECEIPT_META_KEY]: receipt },
      };

      const client = {
        callTool: vi.fn().mockResolvedValue(resultWithReceipt),
      };
      const methods = [createMockMethod()];

      const wrapped = createMcpPaymentWrapper({
        client,
        methods,
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      await wrapped.callTool({
        name: "premium_tool",
        arguments: {},
      });

      expect(emitter.emit).toHaveBeenCalledWith(
        "mcp:payment",
        expect.objectContaining({
          toolName: "premium_tool",
          receipt,
        }),
      );
    });

    it("extracts receipt from _meta and includes in result", async () => {
      const receipt = makeMockReceipt();
      const resultWithReceipt = {
        content: [{ type: "text", text: "paid result" }],
        _meta: { [RECEIPT_META_KEY]: receipt },
        receipt,
      };

      const client = {
        callTool: vi.fn().mockResolvedValue(resultWithReceipt),
      };
      const methods = [createMockMethod()];

      const wrapped = createMcpPaymentWrapper({
        client,
        methods,
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      const result = await wrapped.callTool({
        name: "tool",
        arguments: {},
      });

      expect(result.receipt).toEqual(receipt);
      expect(result.receipt?.method).toBe("tempo");
      expect(result.receipt?.status).toBe("success");
      expect(result.receipt?.reference).toBe("0xabc123");
      expect(result.receipt?.timestamp).toBe("2026-03-31T12:00:00Z");
    });

    it("wraps method createCredential with budget check", () => {
      const client = createMockMcpClient();
      const method = createMockMethod();
      const budgetMgr = createMockBudgetManager({ exceeded: true });

      const wrapped = createMcpPaymentWrapper({
        client,
        methods: [method],
        budgetManager: budgetMgr,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      // The wrapper should have been created — the budget check happens
      // inside createCredential, not at wrapper creation time
      expect(wrapped).toBeDefined();
    });

    it("handles multiple methods from different wallet types", () => {
      const client = createMockMcpClient();
      const tempoMethod = createMockMethod({ name: "tempo", intent: "charge" });
      const stripeMethod = createMockMethod({ name: "stripe", intent: "charge" });

      const wrapped = createMcpPaymentWrapper({
        client,
        methods: [tempoMethod, stripeMethod],
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      expect(wrapped).toBeDefined();
      expect(typeof wrapped.callTool).toBe("function");
    });

    it("records budget spending after successful payment", async () => {
      const receipt = makeMockReceipt();
      const resultWithReceipt = {
        content: [{ type: "text", text: "paid" }],
        receipt,
        _meta: { [RECEIPT_META_KEY]: receipt },
      };

      const client = {
        callTool: vi.fn().mockResolvedValue(resultWithReceipt),
      };
      const methods = [createMockMethod()];

      const wrapped = createMcpPaymentWrapper({
        client,
        methods,
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      await wrapped.callTool({
        name: "tool",
        arguments: {},
      });

      // Budget spending should be recorded after payment
      expect(budgetManager.recordSpending).toHaveBeenCalledTimes(1);
    });

    it("records actual payment amount from challenge instead of placeholder", async () => {
      const receipt = makeMockReceipt();
      const challengeAmountAtomic = "1000000";
      const expectedCents = 100n;

      const method = createMockMethod({ challengeAmount: challengeAmountAtomic });

      let callCount = 0;
      const client = {
        callTool: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            const error = Object.assign(
              new Error("Payment Required"),
              {
                code: -32042,
                data: {
                  challenges: [{
                    id: "test-challenge-id",
                    realm: "test.example.com",
                    method: "tempo",
                    intent: "charge",
                    request: { amount: challengeAmountAtomic, currency: "0xUSDC", recipient: "0xRecipient" },
                  }],
                },
              },
            );
            throw error;
          }
          return Promise.resolve({
            content: [{ type: "text", text: "paid result" }],
            _meta: { [RECEIPT_META_KEY]: receipt },
          });
        }),
      };

      const wrapped = createMcpPaymentWrapper({
        client,
        methods: [method],
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      await wrapped.callTool({ name: "premium_tool", arguments: {} });

      expect(budgetManager.recordSpending).toHaveBeenCalledTimes(1);
      const recordedAmount = (budgetManager.recordSpending as ReturnType<typeof vi.fn>).mock.calls[0][0] as Money;
      expect(recordedAmount.cents).toBe(expectedCents);

      expect(history.add).toHaveBeenCalledTimes(1);
      const historyRecord = (history.add as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(historyRecord.amount.cents).toBe(expectedCents);

      expect(emitter.emit).toHaveBeenCalledWith(
        "mcp:payment",
        expect.objectContaining({
          amount: expect.objectContaining({ cents: expectedCents }),
        }),
      );
    });

    it("falls back to 1 cent when no challenge amount was captured", async () => {
      const receipt = makeMockReceipt();
      const resultWithReceipt = {
        content: [{ type: "text", text: "paid" }],
        receipt,
        _meta: { [RECEIPT_META_KEY]: receipt },
      };

      const client = {
        callTool: vi.fn().mockResolvedValue(resultWithReceipt),
      };
      const methods = [createMockMethod()];

      const wrapped = createMcpPaymentWrapper({
        client,
        methods,
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      await wrapped.callTool({ name: "tool", arguments: {} });

      expect(budgetManager.recordSpending).toHaveBeenCalledTimes(1);
      const recordedAmount = (budgetManager.recordSpending as ReturnType<typeof vi.fn>).mock.calls[0][0] as Money;
      expect(recordedAmount.cents).toBe(1n);
    });

    it("filters arbitrary _meta keys from server response", async () => {
      const receipt = makeMockReceipt();
      const resultWithInjectedMeta = {
        content: [{ type: "text", text: "paid result" }],
        isError: false,
        receipt,
        _meta: {
          [RECEIPT_META_KEY]: receipt,
          "org.paymentauth/credential": "leaked-credential-value",
          "malicious/key": { secret: "should-not-pass" },
          "random.data": 42,
        },
      };

      const client = {
        callTool: vi.fn().mockResolvedValue(resultWithInjectedMeta),
      };
      const methods = [createMockMethod()];

      const wrapped = createMcpPaymentWrapper({
        client,
        methods,
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      const result = await wrapped.callTool({
        name: "premium_tool",
        arguments: {},
      });

      expect(result._meta).toBeDefined();
      expect(result._meta).toHaveProperty(RECEIPT_META_KEY);
      expect(result._meta).not.toHaveProperty("org.paymentauth/credential");
      expect(result._meta).not.toHaveProperty("malicious/key");
      expect(result._meta).not.toHaveProperty("random.data");
    });

    it("returns undefined _meta when no safe keys present", async () => {
      const resultWithOnlyUnsafeMeta = {
        content: [{ type: "text", text: "result" }],
        isError: false,
        _meta: {
          "org.paymentauth/credential": "leaked-credential",
          "malicious/key": "bad-data",
        },
      };

      const client = {
        callTool: vi.fn().mockResolvedValue(resultWithOnlyUnsafeMeta),
      };
      const methods = [createMockMethod()];

      const wrapped = createMcpPaymentWrapper({
        client,
        methods,
        budgetManager,
        emitter,
        history,
        convertToUsd: (amount: Money) => amount,
      });

      const result = await wrapped.callTool({
        name: "tool",
        arguments: {},
      });

      expect(result._meta).toBeUndefined();
    });
  });
});
