import type { BoltzPayResponse, ChainNamespace } from "@boltzpay/sdk";
import type { Command } from "commander";
import { createSdkFromEnv } from "../config.js";
import { handleCliError } from "../output/errors.js";
import { formatFetchResult } from "../output/formatter.js";
import { formatJsonOutput } from "../output/json.js";
import { isValidUrl } from "../validation.js";

const VALID_CHAINS = new Set<string>(["evm", "svm"]);

function parseHeaders(raw: string[] | undefined): Record<string, string> {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const entry of raw) {
    const colonIndex = entry.indexOf(":");
    if (colonIndex === -1) continue;
    const key = entry.slice(0, colonIndex).trim();
    const value = entry.slice(colonIndex + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

function writeDebugInfo(
  url: string,
  method: string,
  duration: number,
  response: BoltzPayResponse,
): void {
  process.stderr.write(`\n[debug] URL: ${url}\n`);
  process.stderr.write(`[debug] Method: ${method}\n`);
  process.stderr.write(`[debug] Duration: ${duration}ms\n`);
  process.stderr.write(`[debug] Status: ${response.status}\n`);
  process.stderr.write(`[debug] Protocol: ${response.protocol ?? "none"}\n`);
  process.stderr.write(
    `[debug] Headers: ${JSON.stringify(response.headers)}\n`,
  );
}

function formatPaymentForJson(response: BoltzPayResponse): {
  protocol: string;
  amount: string;
  currency: string;
  txHash: string | null;
} | null {
  if (!response.payment) return null;
  return {
    protocol: response.payment.protocol,
    amount: response.payment.amount.toDisplayString(),
    currency: response.payment.amount.currency,
    txHash: response.payment.txHash ?? null,
  };
}

export function registerFetchCommand(program: Command): void {
  program
    .command("fetch")
    .description("Fetch data from a paid API endpoint")
    .argument("<url>", "URL of the paid endpoint")
    .option("-m, --method <method>", "HTTP method", "GET")
    .option("-H, --header <header...>", "HTTP headers (key:value)")
    .option("-d, --data <body>", "Request body")
    .option("-c, --chain <chain>", "Override chain selection (evm or svm)")
    .action(
      async (
        url: string,
        opts: {
          method: string;
          header?: string[];
          data?: string;
          chain?: string;
        },
        command: Command,
      ) => {
        const globalOpts = command.parent?.opts<{
          json: boolean;
          verbose: boolean;
          debug: boolean;
        }>();
        const jsonMode = globalOpts?.json ?? false;
        const detail =
          (globalOpts?.verbose ?? false)
            ? ("verbose" as const)
            : ("normal" as const);
        const debug = globalOpts?.debug ?? false;

        if (!isValidUrl(url)) {
          handleCliError(new Error(`Invalid URL: ${url}`), { jsonMode });
          return;
        }

        const sdk = createSdkFromEnv();
        try {
          if (opts.chain && !VALID_CHAINS.has(opts.chain)) {
            const msg = `Invalid chain "${opts.chain}". Must be "evm" or "svm".`;
            handleCliError(new Error(msg), { jsonMode });
          }

          const headers = parseHeaders(opts.header);
          const body = opts.data
            ? new TextEncoder().encode(opts.data)
            : undefined;

          const startTime = Date.now();
          const response = await sdk.fetch(url, {
            method: opts.method,
            headers,
            body,
            chain: opts.chain as ChainNamespace | undefined,
          });
          const duration = Date.now() - startTime;
          const responseBody = await response.text();

          if (jsonMode) {
            const output = formatJsonOutput({
              success: true,
              data: responseBody,
              payment: formatPaymentForJson(response),
              metadata: { url, status: response.status, duration },
            });
            process.stdout.write(`${output}\n`);
          } else {
            process.stdout.write(
              `${formatFetchResult({ response, body: responseBody, duration, url, detail })}\n`,
            );
          }

          if (debug) {
            writeDebugInfo(url, opts.method, duration, response);
          }
        } catch (error: unknown) {
          handleCliError(error, { jsonMode });
        } finally {
          sdk.close();
        }
      },
    );
}
