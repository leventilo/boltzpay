// biome-ignore lint/suspicious/noConsole: MCP server intentionally redirects console.log to stderr for stdio transport
console.log = (...args: unknown[]) => console.error("[boltzpay-mcp]", ...args);

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSdkFromEnv } from "./config.js";
import { registerAllTools } from "./server.js";

async function main(): Promise<void> {
  if (process.argv[2] === "setup") {
    const { runSetup } = await import("./setup.js");
    await runSetup();
    return;
  }

  const sdk = createSdkFromEnv();

  const server = new McpServer({
    name: "boltzpay",
    version: "0.1.1",
  });

  registerAllTools(server, sdk);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
  console.error("BoltzPay MCP server started");
}

main().catch((err: unknown) => {
  // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
  console.error("Fatal:", err);
  process.exitCode = 1;
});
