import type { BoltzPay, ChainNamespace } from "@boltzpay/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { handleToolError } from "../errors.js";

export function registerFetch(server: McpServer, sdk: BoltzPay): void {
  server.registerTool(
    "boltzpay_fetch",
    {
      title: "Fetch Paid Endpoint",
      description:
        "Fetch data from a paid API endpoint. Automatically detects the payment protocol (x402 or L402), pays the required amount, and returns a structured JSON response with status, ok, body, and optional payment metadata.",
      inputSchema: {
        url: z.string().url().describe("The URL of the paid API endpoint"),
        method: z.string().optional().describe("HTTP method (default: GET)"),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Additional HTTP headers as key-value pairs"),
        body: z.string().optional().describe("Request body as a string"),
        chain: z
          .enum(["evm", "svm"])
          .optional()
          .describe("Override chain selection (evm or svm)"),
      },
    },
    async (
      { url, method, headers, body, chain },
      _extra,
    ): Promise<CallToolResult> => {
      try {
        const response = await sdk.fetch(url, {
          method,
          headers,
          body: body ? new TextEncoder().encode(body) : undefined,
          chain: chain as ChainNamespace | undefined,
        });
        const text = await response.text();
        const result = {
          status: response.status,
          ok: response.ok,
          body: text,
          ...(response.payment
            ? {
                payment: {
                  protocol: response.payment.protocol,
                  amount: response.payment.amount.toDisplayString(),
                },
              }
            : {}),
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
