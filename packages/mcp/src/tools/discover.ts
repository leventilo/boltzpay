import type { BoltzPay } from "@boltzpay/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { handleToolError } from "../errors.js";

export function registerDiscover(server: McpServer, sdk: BoltzPay): void {
  server.registerTool(
    "boltzpay_discover",
    {
      title: "Discover Paid APIs",
      description:
        "Browse paid API endpoints from the BoltzPay registry with filtering by protocol, score, and category.",
      inputSchema: {
        category: z.string().optional().describe("Filter by category"),
        protocol: z
          .string()
          .optional()
          .describe("Filter by protocol (x402, l402, mpp)"),
        minScore: z
          .number()
          .optional()
          .describe("Minimum trust score 0-100"),
        query: z
          .string()
          .optional()
          .describe("Search endpoints by name or URL"),
      },
    },
    async ({ category, protocol, minScore, query }): Promise<CallToolResult> => {
      try {
        const entries = await sdk.discover({
          category,
          protocol,
          minScore,
          query,
        });

        if (entries.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No APIs found matching the given filters.`,
              },
            ],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );
}
