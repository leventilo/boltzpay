import { BoltzPay } from "@boltzpay/sdk";
import { createBudgetTool } from "./tools/budget";
import { createCheckTool } from "./tools/check";
import { createDiagnoseTool } from "./tools/diagnose";
import { createDiscoverTool } from "./tools/discover";
import { createFetchTool } from "./tools/fetch";
import { createHistoryTool } from "./tools/history";
import { createQuoteTool } from "./tools/quote";
import { createWalletTool } from "./tools/wallet";
import type { BoltzPayToolsConfig } from "./types";

export type { BoltzPayToolsConfig } from "./types";

export function boltzpayTools(config?: BoltzPayToolsConfig) {
  const sdk = config instanceof BoltzPay ? config : new BoltzPay(config ?? {});

  return {
    boltzpay_fetch: createFetchTool(sdk),
    boltzpay_check: createCheckTool(sdk),
    boltzpay_diagnose: createDiagnoseTool(sdk),
    boltzpay_quote: createQuoteTool(sdk),
    boltzpay_discover: createDiscoverTool(sdk),
    boltzpay_budget: createBudgetTool(sdk),
    boltzpay_history: createHistoryTool(sdk),
    boltzpay_wallet: createWalletTool(sdk),
  };
}
