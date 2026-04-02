import type { DiagnoseResult } from "@boltzpay/sdk";
import type { Command } from "commander";

import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import { formatDiagnoseResult } from "../output/formatter.js";
import { formatJsonOutput } from "../output/json.js";
import { isValidUrl } from "../validation.js";

export function registerDiagnoseCommand(program: Command): void {
  program
    .command("diagnose")
    .description("Diagnose a paid endpoint — protocol, format, scheme, health")
    .argument("<url>", "URL to diagnose")
    .action(
      async (url: string, _opts: Record<string, unknown>, command: Command) => {
        const globalOpts = command.parent?.opts<{ json: boolean }>();
        const jsonMode = globalOpts?.json ?? false;

        if (!isValidUrl(url)) {
          const err = new Error(`Invalid URL: ${url}`);
          handleCliError(err, { jsonMode });
        }

        const sdk = createSdkFromEnv();
        try {
          const result = await sdk.diagnose(url);

          if (jsonMode) {
            const output = formatJsonOutput({
              success: true,
              data: buildJsonData(result),
              payment: null,
              metadata: {
                url,
                status: 0,
                duration: result.latencyMs,
              },
            });
            process.stdout.write(`${output}\n`);
          } else {
            const formatted = formatDiagnoseResult(result);
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

function buildJsonData(result: DiagnoseResult): Record<string, unknown> {
  return {
    url: result.url,
    classification: result.classification,
    ...(result.deathReason ? { deathReason: result.deathReason } : {}),
    ...(result.httpStatus != null ? { httpStatus: result.httpStatus } : {}),
    isPaid: result.isPaid,
    protocol: result.protocol ?? null,
    formatVersion: result.formatVersion ?? null,
    scheme: result.scheme ?? null,
    network: result.network ?? null,
    price: result.price?.toDisplayString() ?? null,
    facilitator: result.facilitator ?? null,
    health: result.health,
    latencyMs: result.latencyMs,
    postOnly: result.postOnly,
    ...(result.chains
      ? {
          chains: result.chains.map((c) => ({
            namespace: c.namespace,
            network: c.network,
            price: c.price.toDisplayString(),
            payTo: c.payTo ?? null,
            scheme: c.scheme,
          })),
        }
      : {}),
    ...(result.rawAccepts
      ? {
          rawAccepts: result.rawAccepts.map((a) => ({
            ...a,
            amount: String(a.amount),
          })),
        }
      : {}),
    ...(result.timing ? { timing: result.timing } : {}),
    ...(result.mppMethods ? { mppMethods: result.mppMethods } : {}),
    ...(result.inputHints ? { inputHints: result.inputHints } : {}),
  };
}
