import type { EndpointHealth } from "@boltzpay/sdk";
import { getMergedDirectory } from "@boltzpay/sdk";
import type { Command } from "commander";

import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import { formatVerifyDirectoryResult } from "../output/formatter.js";
import { formatJsonOutput } from "../output/json.js";
import { renderProgress } from "../output/visuals.js";

const DEFAULT_CONCURRENCY = 10;
const PROGRESS_CLEAR_WIDTH = 80;

interface VerifyEntry {
  readonly name: string;
  readonly health: EndpointHealth;
  readonly protocol: string;
  readonly price: string;
  readonly url: string;
}

async function promisePool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completedCount = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]!, index);
      completedCount++;
      onProgress?.(completedCount, items.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      worker(),
    ),
  );
  return results;
}

const HEALTH_ORDER: Record<EndpointHealth, number> = {
  healthy: 0,
  degraded: 1,
  dead: 2,
};

export function registerVerifyDirectoryCommand(program: Command): void {
  program
    .command("verify-directory")
    .description("Probe all directory endpoints and report health status")
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const globalOpts = command.parent?.opts<{ json: boolean }>();
      const jsonMode = globalOpts?.json ?? false;

      const sdk = createSdkFromEnv();
      try {
        const entries = await getMergedDirectory({ live: true });

        process.stderr.write(renderProgress(0, entries.length));

        const results = await promisePool<
          (typeof entries)[number],
          VerifyEntry
        >(
          entries,
          DEFAULT_CONCURRENCY,
          async (entry) => {
            try {
              const result = await sdk.diagnose(entry.url);
              return {
                name: entry.name,
                health: result.health,
                protocol: result.protocol ?? entry.protocol,
                price: result.price?.toDisplayString() ?? entry.pricing,
                url: entry.url,
              };
            } catch {
              return {
                name: entry.name,
                health: "dead" as const,
                protocol: entry.protocol,
                price: entry.pricing,
                url: entry.url,
              };
            }
          },
          (done, total) => {
            process.stderr.write(renderProgress(done, total));
          },
        );

        process.stderr.write(`\r${" ".repeat(PROGRESS_CLEAR_WIDTH)}\r`);

        const sorted = [...results].sort(
          (a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health],
        );

        if (jsonMode) {
          const output = formatJsonOutput({
            success: true,
            data: sorted,
            payment: null,
            metadata: { url: "", status: 0, duration: 0 },
          });
          process.stdout.write(`${output}\n`);
        } else {
          const formatted = formatVerifyDirectoryResult(sorted);
          process.stdout.write(`${formatted}\n`);
        }

        if (results.some((r) => r.health === "dead")) {
          process.exitCode = 1;
        }
      } catch (error: unknown) {
        handleCliError(error, { jsonMode });
      } finally {
        sdk.close();
      }
    });
}
