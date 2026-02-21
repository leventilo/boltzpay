import type { Command } from "commander";

import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import { formatBudgetResult } from "../output/formatter.js";
import { formatJsonOutput } from "../output/json.js";

export function registerBudgetCommand(program: Command): void {
  program
    .command("budget")
    .description("Show remaining spending budget")
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const globalOpts = command.parent?.opts<{ json: boolean }>();
      const jsonMode = globalOpts?.json ?? false;

      const sdk = createSdkFromEnv();
      try {
        const budget = sdk.getBudget();

        if (jsonMode) {
          const output = formatJsonOutput({
            success: true,
            data: {
              dailySpent: budget.dailySpent.toDisplayString(),
              monthlySpent: budget.monthlySpent.toDisplayString(),
              dailyLimit: budget.dailyLimit?.toDisplayString() ?? null,
              monthlyLimit: budget.monthlyLimit?.toDisplayString() ?? null,
              perTransactionLimit:
                budget.perTransactionLimit?.toDisplayString() ?? null,
              dailyRemaining: budget.dailyRemaining?.toDisplayString() ?? null,
              monthlyRemaining:
                budget.monthlyRemaining?.toDisplayString() ?? null,
            },
            payment: null,
            metadata: { url: "", status: 0, duration: 0 },
          });
          process.stdout.write(`${output}\n`);
        } else {
          const formatted = formatBudgetResult(budget);
          process.stdout.write(`${formatted}\n`);
        }
      } catch (error: unknown) {
        handleCliError(error, { jsonMode });
      } finally {
        sdk.close();
      }
    });
}
