import type { BoltzPay } from "@boltzpay/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { handleToolError } from "../errors.js";

export function registerWallet(server: McpServer, sdk: BoltzPay): void {
  server.registerTool(
    "boltzpay_wallet",
    {
      title: "Wallet Status",
      description:
        "Check wallet connectivity, credentials, balances, and budget. " +
        "Tests the CDP connection when credentials are configured.",
    },
    async (_extra): Promise<CallToolResult> => {
      try {
        const status = await sdk.getWalletStatus();

        const result = {
          network: status.network,
          isTestnet: status.isTestnet,
          protocols: status.protocols,
          canPay: status.canPay,
          credentials: status.credentials,
          connection: status.connection,
          accounts: {
            evm: status.accounts.evm
              ? {
                  address: status.accounts.evm.address,
                  balance:
                    status.accounts.evm.balance?.toDisplayString() ?? null,
                }
              : null,
            svm: status.accounts.svm
              ? {
                  address: status.accounts.svm.address,
                  balance:
                    status.accounts.svm.balance?.toDisplayString() ?? null,
                }
              : null,
          },
          budget: formatBudget(status.budget),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}

function formatBudget(
  budget: ReturnType<BoltzPay["getBudget"]>,
): Record<string, unknown> {
  const hasLimits =
    budget.dailyLimit || budget.monthlyLimit || budget.perTransactionLimit;

  if (!hasLimits) {
    return { configured: false };
  }

  const result: Record<string, unknown> = { configured: true };

  if (budget.dailyLimit) {
    result.daily = {
      limit: budget.dailyLimit.toDisplayString(),
      spent: budget.dailySpent.toDisplayString(),
      remaining: budget.dailyRemaining?.toDisplayString() ?? "$0.00",
    };
  }
  if (budget.monthlyLimit) {
    result.monthly = {
      limit: budget.monthlyLimit.toDisplayString(),
      spent: budget.monthlySpent.toDisplayString(),
      remaining: budget.monthlyRemaining?.toDisplayString() ?? "$0.00",
    };
  }
  if (budget.perTransactionLimit) {
    result.perTransaction = {
      limit: budget.perTransactionLimit.toDisplayString(),
    };
  }

  return result;
}
