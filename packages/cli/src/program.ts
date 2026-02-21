import { Command } from "commander";

import { registerBudgetCommand } from "./commands/budget.js";
import { registerCheckCommand } from "./commands/check.js";
import { registerDemoCommand } from "./commands/demo.js";
import { registerDiscoverCommand } from "./commands/discover.js";
import { registerFetchCommand } from "./commands/fetch.js";
import { registerHistoryCommand } from "./commands/history.js";
import { registerQuoteCommand } from "./commands/quote.js";
import { registerWalletCommand } from "./commands/wallet.js";

export const program = new Command();

program
  .name("boltzpay")
  .version("0.1.0")
  .description("BoltzPay CLI — pay for API data from the terminal")
  .option("-j, --json", "Output as JSON envelope", false)
  .option("-v, --verbose", "Show protocol and timing details", false)
  .option("--debug", "Show full request/response dump", false);

registerFetchCommand(program);
registerQuoteCommand(program);
registerBudgetCommand(program);
registerHistoryCommand(program);
registerDiscoverCommand(program);
registerWalletCommand(program);
registerCheckCommand(program);
registerDemoCommand(program);
