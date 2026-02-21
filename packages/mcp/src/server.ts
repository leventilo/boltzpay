import type { BoltzPay } from "@boltzpay/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBudget } from "./tools/budget.js";
import { registerCheck } from "./tools/check.js";
import { registerDiscover } from "./tools/discover.js";
import { registerFetch } from "./tools/fetch.js";
import { registerHistory } from "./tools/history.js";
import { registerQuote } from "./tools/quote.js";
import { registerWallet } from "./tools/wallet.js";

export function registerAllTools(server: McpServer, sdk: BoltzPay): void {
  registerFetch(server, sdk);
  registerQuote(server, sdk);
  registerBudget(server, sdk);
  registerHistory(server, sdk);
  registerDiscover(server, sdk);
  registerWallet(server, sdk);
  registerCheck(server, sdk);
}
