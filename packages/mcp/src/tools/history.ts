import { type BoltzPay, networkToShortName } from "@boltzpay/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { handleToolError } from "../errors.js";

export function registerHistory(server: McpServer, sdk: BoltzPay): void {
  server.registerTool(
    "boltzpay_history",
    {
      title: "Payment History",
      description:
        "List recent payments made during this session, including URLs, amounts, protocols, chains, and timestamps. Use this to review what has been paid for.",
    },
    async (_extra): Promise<CallToolResult> => {
      try {
        const records = sdk.getHistory();

        if (records.length === 0) {
          return {
            content: [{ type: "text", text: "No payments made yet" }],
          };
        }

        const formatted = records.map((record) => ({
          url: record.url,
          protocol: record.protocol,
          amount: record.amount.toDisplayString(),
          chain: networkToShortName(record.network),
          network: record.network ?? null,
          timestamp: record.timestamp.toISOString(),
          txHash: record.txHash ?? null,
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
        };
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
