import type { BoltzPay } from "@boltzpay/sdk";
import { tool } from "ai";
import { z } from "zod";

export function createHistoryTool(sdk: BoltzPay) {
  return tool({
    description:
      "View payment history for this session. Shows all completed payments with protocol, amount, URL, and timestamp. Works without Coinbase credentials.",
    inputSchema: z.object({}),
    execute: async () => {
      const records = sdk.getHistory();
      return {
        count: records.length,
        payments: records.map((r) => ({
          id: r.id,
          url: r.url,
          protocol: r.protocol,
          amount: r.amount.toDisplayString(),
          timestamp: r.timestamp.toISOString(),
          txHash: r.txHash,
          network: r.network,
        })),
      };
    },
  });
}
