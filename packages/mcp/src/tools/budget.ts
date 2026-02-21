import type { BoltzPay } from "@boltzpay/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { handleToolError } from "../errors.js";

export function registerBudget(server: McpServer, sdk: BoltzPay): void {
  server.registerTool(
    "boltzpay_budget",
    {
      title: "Check Budget Status",
      description:
        "View your current spending budget status including limits, amount spent, and remaining balance. Use this to check how much you can still spend.",
    },
    async (_extra): Promise<CallToolResult> => {
      try {
        const state = sdk.getBudget();

        const hasBudget =
          state.dailyLimit !== undefined ||
          state.monthlyLimit !== undefined ||
          state.perTransactionLimit !== undefined;

        if (!hasBudget) {
          return {
            content: [
              {
                type: "text",
                text: "No budget limits configured. All transactions are allowed without spending caps.",
              },
            ],
          };
        }

        const result: Record<string, unknown> = {};

        if (state.dailyLimit) {
          result.daily = {
            limit: state.dailyLimit.toDisplayString(),
            spent: state.dailySpent.toDisplayString(),
            remaining: state.dailyRemaining?.toDisplayString() ?? "N/A",
          };
        }

        if (state.monthlyLimit) {
          result.monthly = {
            limit: state.monthlyLimit.toDisplayString(),
            spent: state.monthlySpent.toDisplayString(),
            remaining: state.monthlyRemaining?.toDisplayString() ?? "N/A",
          };
        }

        if (state.perTransactionLimit) {
          result.perTransaction = {
            limit: state.perTransactionLimit.toDisplayString(),
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
