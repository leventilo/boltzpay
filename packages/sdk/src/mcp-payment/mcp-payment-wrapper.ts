import { AsyncLocalStorage } from "node:async_hooks";
import { Money } from "@boltzpay/core";
import type { Method } from "mppx";
import { Mcp } from "mppx";
import { McpClient } from "mppx/mcp-sdk/client";
import { BUDGET_EXCEEDED_CODES } from "../budget/budget-exceeded-codes";
import type { BudgetManager } from "../budget/budget-manager";
import { BudgetExceededError } from "../errors/budget-exceeded-error";
import { ConfigurationError } from "../errors/configuration-error";
import type { TypedEventEmitter } from "../events/event-emitter";
import type { PaymentHistory } from "../history/payment-history";
import type { PaymentRecord } from "../history/types";

export interface McpPaymentReceipt {
  readonly method: string;
  readonly status: string;
  readonly reference: string;
  readonly timestamp: string;
}

export interface WrappedCallToolResult {
  readonly content: unknown;
  readonly isError?: boolean;
  readonly _meta?: Record<string, unknown>;
  readonly receipt?: McpPaymentReceipt;
}

export interface WrappedMcpClient {
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    options?: unknown,
  ): Promise<WrappedCallToolResult>;
}

interface McpClientLike {
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    options?: unknown,
  ): Promise<unknown>;
}

interface McpWrapperParams {
  readonly client: McpClientLike;
  readonly methods: readonly Method.AnyClient[];
  readonly budgetManager: BudgetManager;
  readonly emitter: TypedEventEmitter;
  readonly history: PaymentHistory;
  readonly convertToUsd: (amount: Money) => Money;
}

const VALID_CHALLENGE_AMOUNT = /^\d+$/;

function wrapMethodsWithBudgetCheck(
  methods: readonly Method.AnyClient[],
  budgetManager: BudgetManager,
  convertToUsd: (amount: Money) => Money,
  paymentAmounts: Map<string, Money>,
  callIdStorage: AsyncLocalStorage<string>,
): Method.AnyClient[] {
  return methods.map((method) => {
    const originalCreateCredential = method.createCredential;
    return {
      ...method,
      createCredential: async (params: {
        challenge: { request: Record<string, unknown> };
      }) => {
        const challengeRequest = params.challenge.request;
        const rawAmount = challengeRequest.amount;

        if (rawAmount !== undefined) {
          const amountStr = String(rawAmount);
          const amountCents = parseChallengeAmount(amountStr);
          const usdAmount = convertToUsd(amountCents);
          const callId = callIdStorage.getStore();
          if (callId) {
            paymentAmounts.set(callId, usdAmount);
          }
          const budgetCheck = budgetManager.checkTransaction(usdAmount);

          if (budgetCheck.exceeded) {
            const code = BUDGET_EXCEEDED_CODES[budgetCheck.period];
            throw new BudgetExceededError(code, usdAmount, budgetCheck.limit);
          }
        }

        return originalCreateCredential.call(method, params);
      },
    };
  });
}

function parseChallengeAmount(amountStr: string): Money {
  if (!VALID_CHALLENGE_AMOUNT.test(amountStr)) {
    throw new ConfigurationError(
      "invalid_config",
      `Invalid MPP challenge amount: "${amountStr}" — expected a non-negative integer string`,
    );
  }
  // MPP challenge amounts are in atomic units (e.g., "1000000" for USDC = $1.00)
  // We parse as cents since that's the smallest unit we track
  const atomic = BigInt(amountStr);
  // Atomic units for USDC = 6 decimals, 1_000_000 atomic = $1.00 = 100 cents
  const USDC_ATOMIC_PER_CENT = 10_000n;
  const cents = atomic / USDC_ATOMIC_PER_CENT;
  const finalCents = cents === 0n && atomic > 0n ? 1n : cents;
  return Money.fromCents(finalCents);
}

const SAFE_META_KEYS = new Set([Mcp.receiptMetaKey]);

function filterMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const filtered: Record<string, unknown> = {};
  let hasKeys = false;
  for (const [key, value] of Object.entries(meta)) {
    if (SAFE_META_KEYS.has(key)) {
      filtered[key] = value;
      hasKeys = true;
    }
  }
  return hasKeys ? filtered : undefined;
}

function extractReceipt(
  result: Record<string, unknown>,
): McpPaymentReceipt | undefined {
  const meta = result._meta as Record<string, unknown> | undefined;
  if (!meta) return undefined;

  const receipt = result.receipt as McpPaymentReceipt | undefined;
  if (receipt && typeof receipt === "object" && "method" in receipt) {
    return {
      method: String(receipt.method),
      status: String(receipt.status),
      reference: String(receipt.reference),
      timestamp: String(receipt.timestamp),
    };
  }

  const rawReceipt = meta[Mcp.receiptMetaKey] as McpPaymentReceipt | undefined;
  if (
    !rawReceipt ||
    typeof rawReceipt !== "object" ||
    !("method" in rawReceipt)
  ) {
    return undefined;
  }

  return {
    method: String(rawReceipt.method),
    status: String(rawReceipt.status),
    reference: String(rawReceipt.reference),
    timestamp: String(rawReceipt.timestamp),
  };
}

/**
 * Creates a MCP payment wrapper that wraps a MCP Client with automatic
 * MPP payment handling for -32042 errors, budget enforcement before
 * credential creation, and payment history recording.
 */
export function createMcpPaymentWrapper(
  params: McpWrapperParams,
): WrappedMcpClient {
  const { client, methods, budgetManager, emitter, history, convertToUsd } =
    params;

  const paymentAmounts = new Map<string, Money>();
  const callIdStorage = new AsyncLocalStorage<string>();

  const budgetWrappedMethods = wrapMethodsWithBudgetCheck(
    methods,
    budgetManager,
    convertToUsd,
    paymentAmounts,
    callIdStorage,
  );

  const mppxWrapped = McpClient.wrap(
    client as Parameters<typeof McpClient.wrap>[0],
    { methods: budgetWrappedMethods },
  );

  return {
    async callTool(
      callParams: { name: string; arguments?: Record<string, unknown> },
      options?: unknown,
    ): Promise<WrappedCallToolResult> {
      const callId = crypto.randomUUID();

      const result = await callIdStorage.run(callId, () =>
        mppxWrapped.callTool(
          callParams,
          options as Parameters<typeof mppxWrapped.callTool>[1],
        ),
      );

      const resultObj = result as Record<string, unknown>;
      const receipt = extractReceipt(resultObj);

      if (receipt) {
        const paymentAmount = paymentAmounts.get(callId);
        paymentAmounts.delete(callId);
        recordMcpPayment(
          receipt,
          callParams.name,
          paymentAmount,
          history,
          budgetManager,
          emitter,
        );
      } else {
        paymentAmounts.delete(callId);
      }

      return {
        content: resultObj.content,
        isError: resultObj.isError as boolean | undefined,
        _meta: filterMeta(
          resultObj._meta as Record<string, unknown> | undefined,
        ),
        receipt,
      };
    },
  };
}

function recordMcpPayment(
  receipt: McpPaymentReceipt,
  toolName: string,
  paymentAmount: Money | undefined,
  history: PaymentHistory,
  budgetManager: BudgetManager,
  emitter: TypedEventEmitter,
): void {
  const amount = paymentAmount ?? Money.fromCents(1n);

  const record: PaymentRecord = {
    id: crypto.randomUUID(),
    url: `mcp://tool/${toolName}`,
    protocol: "mpp",
    amount,
    timestamp: new Date(),
    txHash: `${receipt.method}:${receipt.reference}`,
    network: undefined,
    transport: "mcp",
  };

  history.add(record);
  budgetManager.recordSpending(amount);

  emitter.emit("mcp:payment", {
    toolName,
    amount,
    receipt,
  });
}
