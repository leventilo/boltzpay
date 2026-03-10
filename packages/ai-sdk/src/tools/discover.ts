import type { BoltzPay } from "@boltzpay/sdk";
import { getDirectoryCategories, toDiscoverJson } from "@boltzpay/sdk";
import { tool } from "ai";
import { z } from "zod";

export function createDiscoverTool(sdk: BoltzPay) {
  const categories = getDirectoryCategories();
  const categoriesList = categories.join(", ");

  return tool({
    description: `Browse a directory of known compatible paid API endpoints with live status checks. Each endpoint is probed in real-time to verify availability and current pricing. Filter by category to find relevant data sources. Categories: ${categoriesList}.`,
    inputSchema: z.object({
      category: z
        .string()
        .optional()
        .describe(`Filter by category (e.g. ${categoriesList})`),
      enableLiveDiscovery: z
        .boolean()
        .optional()
        .describe(
          "Fetch live endpoints from Bazaar Discovery API (default: true)",
        ),
    }),
    execute: async ({ category, enableLiveDiscovery }, { abortSignal }) => {
      abortSignal?.throwIfAborted();

      const entries = await sdk.discover({
        category,
        signal: abortSignal,
        enableLiveDiscovery: enableLiveDiscovery ?? true,
      });

      if (entries.length === 0) {
        return {
          categories,
          count: 0,
          entries: [],
          message: category
            ? `No APIs found for category "${category}". Available categories: ${categoriesList}`
            : "No APIs found.",
        };
      }

      const formatted = entries.map(toDiscoverJson);

      return {
        categories,
        count: formatted.length,
        entries: formatted,
      };
    },
  });
}
