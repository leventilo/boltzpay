import { BoltzPay } from "@boltzpay/sdk";
import { createBudgetTool } from "./tools/budget";
import { createCheckTool } from "./tools/check";
import { createDiscoverTool } from "./tools/discover";
import { createFetchTool } from "./tools/fetch";
import { createHistoryTool } from "./tools/history";
import { createQuoteTool } from "./tools/quote";
import { createWalletTool } from "./tools/wallet";
import type { BoltzPayToolsConfig } from "./types";

export type { BoltzPayToolsConfig } from "./types";

/**
 * Create all BoltzPay tools for Vercel AI SDK.
 *
 * @param config - Optional. A BoltzPayConfig object or a pre-built BoltzPay instance.
 *   When omitted, creates a read-only SDK (no payment credentials).
 *
 * @example
 * ```ts
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { boltzpayTools } from '@boltzpay/ai-sdk';
 *
 * const { text } = await generateText({
 *   model: openai('gpt-4.1'),
 *   tools: boltzpayTools(),
 *   maxSteps: 5,
 *   prompt: 'Discover available paid APIs',
 * });
 * ```
 */
export function boltzpayTools(config?: BoltzPayToolsConfig) {
  const sdk = config instanceof BoltzPay ? config : new BoltzPay(config ?? {});

  return {
    boltzpay_fetch: createFetchTool(sdk),
    boltzpay_check: createCheckTool(sdk),
    boltzpay_quote: createQuoteTool(sdk),
    boltzpay_discover: createDiscoverTool(),
    boltzpay_budget: createBudgetTool(sdk),
    boltzpay_history: createHistoryTool(sdk),
    boltzpay_wallet: createWalletTool(sdk),
  };
}
