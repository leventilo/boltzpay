import type { BoltzPay, DiagnoseResult } from "@boltzpay/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { handleToolError } from "../errors.js";

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

export function registerDiagnose(server: McpServer, sdk: BoltzPay): void {
  server.registerTool(
    "boltzpay_diagnose",
    {
      title: "Diagnose Endpoint",
      description:
        "Full diagnostic of a URL: DNS, protocol detection (x402/L402), format version, pricing, health, and latency. Returns a complete report in one call — no payment credentials required.",
      inputSchema: {
        url: z.string().url().describe("The endpoint URL to diagnose"),
      },
    },
    async ({ url }): Promise<CallToolResult> => {
      try {
        const result = await sdk.diagnose(url);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(formatResult(result), null, 2),
            },
          ],
        };
      } catch (error) {
        return handleToolError(error);
      }
    },
  );
}
