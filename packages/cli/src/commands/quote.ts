import {
  isTestnet,
  Money,
  networkToShortName,
  ProtocolError,
} from "@boltzpay/sdk";
import type { Command } from "commander";

import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import { formatQuoteResult } from "../output/formatter.js";
import { formatJsonOutput } from "../output/json.js";
import { isValidUrl } from "../validation.js";

export function registerQuoteCommand(program: Command): void {
  program
    .command("quote")
    .description("Check the cost of a paid endpoint without paying")
    .argument("<url>", "URL of the paid endpoint")
    .action(
      async (url: string, _opts: Record<string, unknown>, command: Command) => {
        const globalOpts = command.parent?.opts<{
          json: boolean;
          verbose: boolean;
        }>();
        const jsonMode = globalOpts?.json ?? false;

        if (!isValidUrl(url)) {
          const err = new Error(`Invalid URL: ${url}`);
          handleCliError(err, { jsonMode });
        }

        const sdk = createSdkFromEnv();
        try {
          const startTime = Date.now();
          const quote = await sdk.quote(url);
          const duration = Date.now() - startTime;

          const alternatives =
            quote.allAccepts && quote.allAccepts.length > 1
              ? quote.allAccepts.slice(1).map((accept) => ({
                  chain: networkToShortName(accept.network),
                  network: accept.network,
                  amount: Money.fromCents(accept.amount).toDisplayString(),
                }))
              : undefined;

          if (jsonMode) {
            const output = formatJsonOutput({
              success: true,
              data: {
                protocol: quote.protocol,
                amount: quote.amount.toDisplayString(),
                currency: quote.amount.currency,
                network: quote.network ?? null,
                networkName: networkToShortName(quote.network),
                testnet: isTestnet(quote.network),
                ...(alternatives ? { alternatives } : {}),
                ...(quote.inputHints ? { inputHints: quote.inputHints } : {}),
              },
              payment: null,
              metadata: { url, status: 0, duration },
            });
            process.stdout.write(`${output}\n`);
          } else {
            const formatted = formatQuoteResult({
              protocol: quote.protocol,
              amount: quote.amount.toDisplayString(),
              network: quote.network,
              alternatives,
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
                data: {
                  free: true,
                  message: "This endpoint is free (no payment required)",
                },
                payment: null,
                metadata: { url, status: 0, duration: 0 },
              });
              process.stdout.write(`${output}\n`);
            } else {
              process.stdout.write(
                "This endpoint is free (no payment required)\n",
              );
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
