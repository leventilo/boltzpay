import {
  isTestnet,
  Money,
  networkToShortName,
  ProtocolError,
} from "@boltzpay/sdk";
import type { Command } from "commander";

import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import { formatCheckResult } from "../output/formatter.js";
import { formatJsonOutput } from "../output/json.js";
import { isValidUrl } from "../validation.js";

export function registerCheckCommand(program: Command): void {
  program
    .command("check")
    .description("Check if a URL is a paid endpoint")
    .argument("<url>", "URL to check")
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
          const quote = await sdk.quote(url);

          const options =
            quote.allAccepts && quote.allAccepts.length > 1
              ? quote.allAccepts.map((accept, i) => ({
                  chain: networkToShortName(accept.network),
                  network: accept.network,
                  amount: Money.fromCents(accept.amount).toDisplayString(),
                  recommended: i === 0,
                }))
              : undefined;

          if (jsonMode) {
            const output = formatJsonOutput({
              success: true,
              data: {
                isPaid: true,
                protocol: quote.protocol,
                amount: quote.amount.toDisplayString(),
                currency: quote.amount.currency,
                network: quote.network ?? null,
                networkName: networkToShortName(quote.network),
                testnet: isTestnet(quote.network),
                ...(options ? { options } : {}),
              },
              payment: null,
              metadata: { url, status: 0, duration: 0 },
            });
            process.stdout.write(`${output}\n`);
          } else {
            const formatted = formatCheckResult({
              isPaid: true,
              protocol: quote.protocol,
              amount: quote.amount.toDisplayString(),
              network: quote.network,
              options,
            });
            process.stdout.write(`${formatted}\n`);
          }
        } catch (error: unknown) {
          if (
            error instanceof ProtocolError &&
            error.code === "protocol_detection_failed"
          ) {
            if (jsonMode) {
              const output = formatJsonOutput({
                success: true,
                data: { isPaid: false },
                payment: null,
                metadata: { url, status: 0, duration: 0 },
              });
              process.stdout.write(`${output}\n`);
            } else {
              const formatted = formatCheckResult({ isPaid: false });
              process.stdout.write(`${formatted}\n`);
            }
            return;
          }
          handleCliError(error, { jsonMode });
        } finally {
          sdk.close();
        }
      },
    );
}
