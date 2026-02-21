import { type BoltzPay, BoltzPayError } from "@boltzpay/sdk";
import { tool } from "ai";
import { z } from "zod";

export function createFetchTool(sdk: BoltzPay) {
  return tool({
    description:
      "Fetch data from a paid API endpoint. Automatically detects payment protocol (x402 or L402), pays with USDC on Base or Solana, and returns the response. Requires Coinbase credentials.",
    inputSchema: z.object({
      url: z.url().describe("URL of the paid API endpoint"),
      method: z.string().optional().describe("HTTP method (default: GET)"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Additional HTTP headers"),
      chain: z
        .enum(["evm", "svm"])
        .optional()
        .describe("Override chain selection (evm=Base, svm=Solana)"),
    }),
    execute: async ({ url, method, headers, chain }, { abortSignal }) => {
      abortSignal?.throwIfAborted();
      try {
        const response = await sdk.fetch(url, { method, headers, chain });
        const text = await response.text();
        return {
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
      } catch (error: unknown) {
        // Return structured error for LLM consumption instead of crashing the tool
        if (error instanceof BoltzPayError) {
          return {
            ok: false as const,
            error: error.message,
            code: error.code,
          };
        }
        const message =
          error instanceof Error ? error.message : "Unknown payment error";
        return {
          ok: false as const,
          error: message,
          code: "unknown_error",
        };
      }
    },
  });
}
