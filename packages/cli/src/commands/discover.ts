import { getDirectoryCategories, toDiscoverJson } from "@boltzpay/sdk";
import type { Command } from "commander";
import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import { formatDiscoverResult } from "../output/formatter.js";
import { formatJsonOutput } from "../output/json.js";

export function registerDiscoverCommand(program: Command): void {
  program
    .command("discover")
    .description("Browse compatible paid API endpoints with live status")
    .option("-c, --category <category>", "Filter by category")
    .option(
      "--live",
      "Fetch live endpoints from Bazaar Discovery API (default: true)",
    )
    .option("--no-live", "Use static directory only")
    .action(
      async (opts: { category?: string; live?: boolean }, command: Command) => {
        const globalOpts = command.parent?.opts<{ json: boolean }>();
        const jsonMode = globalOpts?.json ?? false;

        const sdk = createSdkFromEnv();
        try {
          const entries = await sdk.discover({
            category: opts.category,
            enableLiveDiscovery: opts.live ?? true,
          });

          if (entries.length === 0) {
            const categories = getDirectoryCategories().join(", ");
            if (jsonMode) {
              const output = formatJsonOutput({
                success: true,
                data: [],
                payment: null,
                metadata: { url: "", status: 0, duration: 0 },
              });
              process.stdout.write(`${output}\n`);
            } else {
              process.stdout.write(
                `No matching endpoints found. Available categories: ${categories}\n`,
              );
            }
            return;
          }

          if (jsonMode) {
            const output = formatJsonOutput({
              success: true,
              data: entries.map(toDiscoverJson),
              payment: null,
              metadata: { url: "", status: 0, duration: 0 },
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
