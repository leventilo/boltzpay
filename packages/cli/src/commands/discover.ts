import type { Command } from "commander";
import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import { formatDiscoverResult } from "../output/formatter.js";
import { formatJsonOutput } from "../output/json.js";

export function registerDiscoverCommand(program: Command): void {
  program
    .command("discover")
    .description("Browse paid API endpoints from the BoltzPay registry")
    .option("-c, --category <category>", "Filter by category")
    .option("-p, --protocol <protocol>", "Filter by protocol (x402, l402, mpp)")
    .option("--min-score <score>", "Minimum trust score (0-100)")
    .option("-q, --query <query>", "Search by name, URL, or description")
    .action(
      async (
        opts: {
          category?: string;
          protocol?: string;
          minScore?: string;
          query?: string;
        },
        command: Command,
      ) => {
        const globalOpts = command.parent?.opts<{ json: boolean }>();
        const jsonMode = globalOpts?.json ?? false;

        const sdk = createSdkFromEnv();
        try {
          const entries = await sdk.discover({
            category: opts.category,
            protocol: opts.protocol,
            minScore: opts.minScore ? parseInt(opts.minScore, 10) : undefined,
            query: opts.query,
          });

          if (entries.length === 0) {
            if (jsonMode) {
              const output = formatJsonOutput({
                success: true,
                data: [],
                payment: null,
              });
              process.stdout.write(`${output}\n`);
            } else {
              process.stdout.write(formatDiscoverResult([]));
            }
            return;
          }

          if (jsonMode) {
            const output = formatJsonOutput({
              success: true,
              data: entries,
              payment: null,
            });
            process.stdout.write(`${output}\n`);
          } else {
            const formatted = formatDiscoverResult(entries);
            process.stdout.write(`${formatted}\n`);
          }
        } catch (error: unknown) {
          handleCliError(error, { jsonMode });
        } finally {
          sdk.close();
        }
      },
    );
}
