import { type BoltzPay, BoltzPayError } from "@boltzpay/sdk";
import { tool } from "ai";
import { z } from "zod";

export function createQuoteTool(sdk: BoltzPay) {
  return tool({
    description:
      "Get a price quote for a paid API endpoint. Returns protocol, amount, network, and multi-chain options if available. Works without Coinbase credentials.",
    inputSchema: z.object({
      url: z.url().describe("URL to get a price quote for"),
    }),
    execute: async ({ url }, { abortSignal }) => {
      abortSignal?.throwIfAborted();
      try {
        const quote = await sdk.quote(url);
        return {
          protocol: quote.protocol,
          amount: quote.amount.toDisplayString(),
          network: quote.network,
          ...(quote.allAccepts
            ? {
                allAccepts: quote.allAccepts.map((a) => ({
                  network: a.network,
                  amount: a.amount,
                })),
              }
            : {}),
        };
      } catch (error: unknown) {
        if (error instanceof BoltzPayError) {
          return {
            error: error.message,
            code: error.code,
          };
        }
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          error: message,
          code: "unknown_error",
        };
      }
    },
  });
}
