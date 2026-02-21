import type { BoltzPay } from "@boltzpay/sdk";
import { Money, networkToShortName, ProtocolError } from "@boltzpay/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { handleToolError } from "../errors.js";

export function registerCheck(server: McpServer, sdk: BoltzPay): void {
  server.registerTool(
    "boltzpay_check",
    {
      title: "Check Paid Endpoint",
      description:
        "Detect if a URL requires payment by attempting protocol detection. Returns isPaid status, protocol, amount, currency, and available chain options if paid.",
      inputSchema: {
        url: z.string().url().describe("The URL to check"),
      },
    },
    async ({ url }): Promise<CallToolResult> => {
      try {
        const quote = await sdk.quote(url);

        const options =
          quote.allAccepts && quote.allAccepts.length > 0
            ? quote.allAccepts.map((accept) => ({
                chain: networkToShortName(accept.network),
                network: accept.network,
                amount: Money.fromCents(accept.amount).toDisplayString(),
              }))
            : undefined;

        const result = {
          isPaid: true,
          protocol: quote.protocol,
          amount: quote.amount.toDisplayString(),
          currency: "USD",
          ...(options ? { options } : {}),
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
                text: JSON.stringify({ isPaid: false }, null, 2),
              },
            ],
          };
        }
        return handleToolError(error);
      }
    },
  );
}
