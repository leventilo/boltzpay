import * as readline from "node:readline/promises";
import { ProtocolError } from "@boltzpay/sdk";
import type { Command } from "commander";

import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import {
  formatDemoHeader,
  formatDemoStep,
  formatWalletStatus,
} from "../output/formatter.js";

const TESTNET_ENDPOINT = "https://nickeljoke.vercel.app/api/joke";
const MAINNET_X402_ENDPOINT =
  "https://x402-tools.vercel.app/api/polymarket/trending";
const MAINNET_L402_ENDPOINT = "https://satring.com/api/v1/analytics";

interface DemoOptions {
  readonly yes?: boolean;
  readonly testnet?: boolean;
}

function selectEndpoint(
  options: DemoOptions,
  capabilities: {
    canPay: boolean;
    canPayLightning: boolean;
    network: string;
  },
): { url: string; label: string } {
  if (options.testnet) {
    return { url: TESTNET_ENDPOINT, label: "Nickel Joke (testnet)" };
  }
  if (capabilities.network === "base-sepolia") {
    return { url: TESTNET_ENDPOINT, label: "Nickel Joke (testnet)" };
  }
  if (capabilities.canPayLightning) {
    return { url: MAINNET_L402_ENDPOINT, label: "Satring Analytics (L402)" };
  }
  if (capabilities.canPay) {
    return { url: MAINNET_X402_ENDPOINT, label: "Polymarket Trending (x402)" };
  }
  return {
    url: MAINNET_X402_ENDPOINT,
    label: "Polymarket Trending (read-only)",
  };
}

async function confirmPayment(skipConfirm: boolean): Promise<boolean> {
  if (skipConfirm) return true;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const onSigint = () => {
    rl.close();
    process.exit(130);
  };
  process.on("SIGINT", onSigint);

  try {
    const answer = await rl.question("  Press Enter to pay (or 'n' to skip): ");
    return answer.trim().toLowerCase() !== "n";
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
  }
}

export function registerDemoCommand(program: Command): void {
  program
    .command("demo")
    .description("Interactive walkthrough of BoltzPay features")
    .option("-y, --yes", "Skip payment confirmation", false)
    .option("--testnet", "Force testnet endpoint", false)
    .action(async (opts: DemoOptions, command: Command) => {
      const globalOpts = command.parent?.opts<{ json: boolean }>();
      const jsonMode = globalOpts?.json ?? false;

      const sdk = createSdkFromEnv();
      try {
        process.stdout.write(formatDemoHeader());

        process.stdout.write(formatDemoStep(1, "Checking wallet status..."));
        const walletStatus = await sdk.getWalletStatus();
        process.stdout.write(`${formatWalletStatus(walletStatus)}\n\n`);

        const capabilities = sdk.getCapabilities();
        const canPay = capabilities.canPay || capabilities.canPayLightning;

        const { url, label } = selectEndpoint(opts, capabilities);
        process.stdout.write(formatDemoStep(2, `Selected endpoint: ${label}`));
        process.stdout.write(`  URL: ${url}\n\n`);

        process.stdout.write(formatDemoStep(3, "Checking endpoint..."));
        try {
          const quote = await sdk.quote(url);
          process.stdout.write(
            `  Protocol: ${quote.protocol}\n` +
              `  Price: ${quote.amount.toDisplayString()}\n\n`,
          );

          if (canPay) {
            process.stdout.write(formatDemoStep(4, "Fetching with payment..."));

            const shouldPay = await confirmPayment(opts.yes ?? false);
            if (!shouldPay) {
              process.stdout.write("  Skipped payment.\n\n");
            } else {
              const start = Date.now();
              const response = await sdk.fetch(url);
              const duration = Date.now() - start;
              const body = await response.text();

              process.stdout.write(
                `  Status: ${response.status}\n` +
                  `  Duration: ${duration}ms\n` +
                  `  Body: ${body.slice(0, 200)}${body.length > 200 ? "..." : ""}\n\n`,
              );

              if (response.payment) {
                process.stdout.write(
                  `  Paid: ${response.payment.amount.toDisplayString()} via ${response.payment.protocol}\n\n`,
                );
              }

              process.stdout.write(formatDemoStep(5, "Session summary"));
              const history = sdk.getHistory();
              process.stdout.write(`  Payments made: ${history.length}\n`);
              const budget = sdk.getBudget();
              process.stdout.write(
                `  Daily spent: ${budget.dailySpent.toDisplayString()}\n\n`,
              );
            }
          } else {
            process.stdout.write(
              formatDemoStep(4, "Read-only mode (no credentials)"),
            );
            process.stdout.write(
              "  Configure COINBASE_API_KEY_ID + secret or NWC_CONNECTION_STRING to enable payments.\n\n",
            );
          }
        } catch (error) {
          if (
            error instanceof ProtocolError &&
            error.code === "protocol_detection_failed"
          ) {
            process.stdout.write(
              "  Endpoint is free (no payment required)\n\n",
            );
          } else {
            throw error;
          }
        }

        process.stdout.write(formatDemoStep(0, "Demo complete!"));
      } catch (error: unknown) {
        handleCliError(error, { jsonMode });
      } finally {
        sdk.close();
      }
    });
}
