import { networkToShortName } from "@boltzpay/sdk";
import type { Command } from "commander";

import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import { formatHistoryResult } from "../output/formatter.js";
import { formatJsonOutput } from "../output/json.js";

export function registerHistoryCommand(program: Command): void {
  program
    .command("history")
    .description("Show payment history for this session")
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const globalOpts = command.parent?.opts<{ json: boolean }>();
      const jsonMode = globalOpts?.json ?? false;

      const sdk = createSdkFromEnv();
      try {
        const records = sdk.getHistory();

        if (jsonMode) {
          const output = formatJsonOutput({
            success: true,
            data: records.map((r) => ({
              id: r.id,
              url: r.url,
              protocol: r.protocol,
              amount: r.amount.toDisplayString(),
              timestamp: r.timestamp.toISOString(),
              txHash: r.txHash ?? null,
              network: r.network ?? null,
              chain: networkToShortName(r.network),
            })),
            payment: null,
            metadata: { url: "", status: 0, duration: 0 },
          });
          process.stdout.write(`${output}\n`);
        } else {
          const formatted = formatHistoryResult(records);
          process.stdout.write(`${formatted}\n`);
        }
      } catch (error: unknown) {
        handleCliError(error, { jsonMode });
      } finally {
        sdk.close();
      }
    });
}
