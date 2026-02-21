import type { BoltzPay } from "@boltzpay/sdk";
import { getDirectoryCategories, toDiscoverJson } from "@boltzpay/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { handleToolError } from "../errors.js";

export function registerDiscover(server: McpServer, sdk: BoltzPay): void {
  const categories = getDirectoryCategories().join(", ");

  server.registerTool(
    "boltzpay_discover",
    {
      title: "Discover Paid APIs",
      description: `Browse a directory of known compatible paid API endpoints with live status checks. Each endpoint is probed in real-time to verify availability and current pricing. Filter by category to find relevant data sources. Categories: ${categories}.`,
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe(`Filter by category (e.g. ${categories})`),
        enableLiveDiscovery: z
          .boolean()
          .optional()
          .describe(
            "Fetch live endpoints from Bazaar Discovery API (default: true)",
          ),
      },
    },
    async ({ category, enableLiveDiscovery }): Promise<CallToolResult> => {
      try {
        const entries = await sdk.discover({
          category,
          enableLiveDiscovery: enableLiveDiscovery ?? true,
        });

        if (entries.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No APIs found for category "${category}". Available categories: ${categories}`,
              },
            ],
          };
        }

        const formatted = entries.map(toDiscoverJson);

        return {
          content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    },
  );
}
