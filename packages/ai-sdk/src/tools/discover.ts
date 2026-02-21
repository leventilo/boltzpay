import {
  API_DIRECTORY,
  type ApiDirectoryEntry,
  getDirectoryCategories,
} from "@boltzpay/sdk";
import { tool } from "ai";
import { z } from "zod";

export function createDiscoverTool() {
  return tool({
    description:
      "Browse compatible paid APIs from the BoltzPay directory. Filter by category to find relevant endpoints. Supports x402 and L402 protocols across Base and Solana chains. Works without credentials.",
    inputSchema: z.object({
      category: z
        .string()
        .optional()
        .describe("Filter by category (e.g. crypto-data, utilities, demo)"),
    }),
    execute: async ({ category }) => {
      const categories = getDirectoryCategories();
      let entries: readonly ApiDirectoryEntry[];

      if (category) {
        const lower = category.toLowerCase();
        entries = API_DIRECTORY.filter((e) => e.category === lower);
      } else {
        entries = API_DIRECTORY;
      }

      return {
        categories,
        count: entries.length,
        entries: entries.map((e) => ({
          name: e.name,
          url: e.url,
          protocol: e.protocol,
          category: e.category,
          description: e.description,
          pricing: e.pricing,
        })),
      };
    },
  });
}
