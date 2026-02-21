import type { Command } from "commander";

import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import { formatWalletStatus } from "../output/formatter.js";
import { formatJsonOutput } from "../output/json.js";

export function registerWalletCommand(program: Command): void {
  program
    .command("wallet")
    .description("Show wallet status, connectivity, and configuration")
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const globalOpts = command.parent?.opts<{ json: boolean }>();
      const jsonMode = globalOpts?.json ?? false;

      const sdk = createSdkFromEnv();
      try {
        const status = await sdk.getWalletStatus();

        if (jsonMode) {
          const output = formatJsonOutput({
            success: true,
            data: status,
            payment: null,
            metadata: { url: "", status: 0, duration: 0 },
          });
          process.stdout.write(`${output}\n`);
        } else {
          process.stdout.write(`${formatWalletStatus(status)}\n`);
        }
      } catch (error: unknown) {
        handleCliError(error, { jsonMode });
      } finally {
        sdk.close();
      }
    });
}
