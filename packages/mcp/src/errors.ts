import {
  BudgetExceededError,
  ConfigurationError,
  InsufficientFundsError,
  NetworkError,
  ProtocolError,
} from "@boltzpay/sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface McpToolError {
  readonly error: string;
  readonly message: string;
  readonly hint: string;
  readonly details?: Record<string, unknown>;
}

function toResult(payload: McpToolError): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

export function handleToolError(error: unknown): CallToolResult {
  if (error instanceof BudgetExceededError) {
    return toResult({
      error: "BUDGET_EXCEEDED",
      message: error.message,
      hint: "Use boltzpay_budget to check limits and remaining balance",
      details: {
        requested: error.requested.toDisplayString(),
        limit: error.limit.toDisplayString(),
      },
    });
  }

  if (error instanceof InsufficientFundsError) {
    return toResult({
      error: "INSUFFICIENT_FUNDS",
      message: error.message,
      hint: "Your wallet does not have enough funds. Top up your USDC balance and try again.",
    });
  }

  if (error instanceof ConfigurationError) {
    return toResult({
      error: "MISSING_CREDENTIALS",
      message: error.message,
      hint: "Set COINBASE_API_KEY_ID, COINBASE_API_KEY_SECRET, and COINBASE_WALLET_SECRET environment variables. Get keys at https://portal.cdp.coinbase.com",
    });
  }

  if (error instanceof ProtocolError) {
    return toResult({
      error: "PROTOCOL_ERROR",
      message: error.message,
      hint: "Check the URL is correct and try boltzpay_check first to verify it accepts payments",
    });
  }

  if (error instanceof NetworkError) {
    return toResult({
      error: "NETWORK_ERROR",
      message: error.message,
      hint: "Verify the endpoint is reachable and try again",
    });
  }

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";
  return toResult({
    error: "INTERNAL_ERROR",
    message,
    hint: "Check server logs for details",
  });
}
