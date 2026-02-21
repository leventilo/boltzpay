import { type BoltzPay, NetworkError, ProtocolError } from "@boltzpay/sdk";
import { tool } from "ai";
import { z } from "zod";

export function createCheckTool(sdk: BoltzPay) {
  return tool({
    description:
      "Check if a URL requires payment. Returns protocol, price, and available chain options if paid. Works without Coinbase credentials.",
    inputSchema: z.object({
      url: z.url().describe("URL to check for payment requirements"),
    }),
    execute: async ({ url }, { abortSignal }) => {
      try {
        abortSignal?.throwIfAborted();
        const quote = await sdk.quote(url);
        return {
          isPaid: true as const,
          protocol: quote.protocol,
          amount: quote.amount.toDisplayString(),
          network: quote.network,
          ...(quote.allAccepts && quote.allAccepts.length > 1
            ? {
                options: quote.allAccepts.map((a) => ({
                  network: a.network,
                  amount: a.amount,
                })),
              }
            : {}),
        };
      } catch (error: unknown) {
        // Only treat protocol detection failures and network errors as "free endpoint"
        // Re-throw configuration errors, type errors, and other unexpected bugs
        if (error instanceof ProtocolError || error instanceof NetworkError) {
          return { isPaid: false as const };
        }
        throw error;
      }
    },
  });
}
