import type { BoltzPay, DiagnoseResult } from "@boltzpay/sdk";
import { tool } from "ai";
import { z } from "zod";

function formatResult(result: DiagnoseResult): Record<string, unknown> {
  const output: Record<string, unknown> = {
    url: result.url,
    classification: result.classification,
    isPaid: result.isPaid,
    health: result.health,
    latencyMs: result.latencyMs,
  };

  if (result.protocol) output.protocol = result.protocol;
  if (result.formatVersion) output.formatVersion = result.formatVersion;
  if (result.scheme) output.scheme = result.scheme;
  if (result.network) output.network = result.network;
  if (result.price) output.price = result.price.toDisplayString();
  if (result.facilitator) output.facilitator = result.facilitator;
  if (result.deathReason) output.deathReason = result.deathReason;
  if (result.httpStatus != null) output.httpStatus = result.httpStatus;
  if (result.postOnly) output.postOnly = true;
  if (result.chains && result.chains.length > 0) {
    output.chains = result.chains.map((c) => ({
      namespace: c.namespace,
      network: c.network,
      price: c.price.toDisplayString(),
      scheme: c.scheme,
    }));
  }
  if (result.timing) output.timing = result.timing;

  return output;
}

export function createDiagnoseTool(sdk: BoltzPay) {
  return tool({
    description:
      "Full diagnostic of a URL: DNS, protocol detection (x402/L402), format version, pricing, health, and latency. Returns a complete report in one call — no payment credentials required.",
    inputSchema: z.object({
      url: z.url().describe("The endpoint URL to diagnose"),
    }),
    execute: async ({ url }, { abortSignal }) => {
      abortSignal?.throwIfAborted();
      const result = await sdk.diagnose(url);
      return formatResult(result);
    },
  });
}
