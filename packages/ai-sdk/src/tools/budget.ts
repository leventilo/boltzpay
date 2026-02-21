import type { BoltzPay } from "@boltzpay/sdk";
import { tool } from "ai";
import { z } from "zod";

export function createBudgetTool(sdk: BoltzPay) {
  return tool({
    description:
      "View current budget limits and spending. Budget limits are set at SDK construction time and cannot be changed at runtime. Works without Coinbase credentials.",
    inputSchema: z.object({
      action: z
        .enum(["get", "set"])
        .describe(
          "Action: 'get' to view budget, 'set' is read-only (returns guidance)",
        ),
    }),
    execute: async ({ action }) => {
      if (action === "set") {
        return {
          error: "Budget limits are immutable at runtime.",
          guidance:
            "Set budget limits when creating the BoltzPay instance via the budget config option: boltzpayTools({ budget: { daily: '10.00', monthly: '100.00', perTransaction: '1.00' } })",
        };
      }

      const state = sdk.getBudget();
      return {
        dailyLimit: state.dailyLimit?.toDisplayString() ?? null,
        dailySpent: state.dailySpent.toDisplayString(),
        dailyRemaining: state.dailyRemaining?.toDisplayString() ?? null,
        monthlyLimit: state.monthlyLimit?.toDisplayString() ?? null,
        monthlySpent: state.monthlySpent.toDisplayString(),
        monthlyRemaining: state.monthlyRemaining?.toDisplayString() ?? null,
        perTransactionLimit:
          state.perTransactionLimit?.toDisplayString() ?? null,
      };
    },
  });
}
