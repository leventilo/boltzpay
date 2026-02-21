import type { BoltzPay } from "@boltzpay/sdk";
import { Money, networkToShortName, ProtocolError } from "@boltzpay/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { handleToolError } from "../errors.js";

export function registerQuote(server: McpServer, sdk: BoltzPay): void {
  server.registerTool(
    "boltzpay_quote",
    {
      title: "Quote Paid Endpoint",
      description:
        "Check if an API endpoint requires payment and how much it costs, without actually paying. Returns the detected protocol, amount, and currency. Use this before boltzpay_fetch to preview costs.",
      inputSchema: {
        url: z.string().url().describe("The URL to check for pricing"),
      },
    },
    async ({ url }): Promise<CallToolResult> => {
      try {
        const quote = await sdk.quote(url);

        const alternatives =
          quote.allAccepts && quote.allAccepts.length > 1
            ? quote.allAccepts.slice(1).map((accept) => ({
                chain: networkToShortName(accept.network),
                network: accept.network,
                amount: Money.fromCents(accept.amount).toDisplayString(),
              }))
            : undefined;

        const result = {
          protocol: quote.protocol,
          amount: quote.amount.toDisplayString(),
          currency: quote.amount.currency,
          network: quote.network ?? "unknown",
          ...(alternatives ? { alternatives } : {}),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        if (
          error instanceof ProtocolError &&
          error.code === "protocol_detection_failed"
        ) {
          return {
            content: [
              {
                type: "text",
                text: "This endpoint does not require payment (free)",
              },
            ],
          };
        }
        return handleToolError(error);
      }
    },
  );
}
