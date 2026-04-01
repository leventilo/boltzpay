import type { BoltzPay } from "@boltzpay/sdk";
import { tool } from "ai";
import { z } from "zod";

export function createDiscoverTool(sdk: BoltzPay) {
  return tool({
    description:
      "Browse paid API endpoints from the BoltzPay registry with filtering by protocol, score, and category.",
    inputSchema: z.object({
      category: z.string().optional().describe("Filter by category"),
      protocol: z
        .string()
        .optional()
        .describe("Filter by protocol (x402, l402, mpp)"),
      minScore: z.number().optional().describe("Minimum trust score 0-100"),
      query: z.string().optional().describe("Search endpoints by name or URL"),
    }),
    execute: async (
      { category, protocol, minScore, query },
      { abortSignal },
    ) => {
      abortSignal?.throwIfAborted();

      const entries = await sdk.discover({
        category,
        protocol,
        minScore,
        query,
        signal: abortSignal,
      });

      if (entries.length === 0) {
        return {
          count: 0,
          entries: [],
          message: "No APIs found matching the given filters.",
        };
      }

      return {
        count: entries.length,
        entries,
      };
    },
  });
}
