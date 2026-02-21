import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

function getConfigPath(): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
    case "win32":
      return join(
        process.env.APPDATA ?? join(home, "AppData", "Roaming"),
        "Claude",
        "claude_desktop_config.json",
      );
    default:
      return join(home, ".config", "claude", "claude_desktop_config.json");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readExistingConfig(
  configPath: string,
): Record<string, unknown> | null {
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (!isPlainObject(parsed)) {
      return null;
    }
    return parsed;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
    console.error(`Warning: could not read config: ${msg}`);
    return null;
  }
}

interface Credentials {
  COINBASE_API_KEY_ID: string;
  COINBASE_API_KEY_SECRET: string;
  COINBASE_WALLET_SECRET: string;
  NWC_CONNECTION_STRING?: string;
  BOLTZPAY_DAILY_BUDGET?: string;
}

function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      resolve(answer.trim());
    });
  });
}

async function promptCredentials(
  rl: ReturnType<typeof createInterface>,
): Promise<Credentials> {
  // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
  console.error("\nBoltzPay MCP Setup");
  // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
  console.error("==================\n");
  // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
  console.error("Get your Coinbase Developer Platform keys at:");
  // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
  console.error("  https://portal.cdp.coinbase.com\n");

  const apiKeyId = await ask(rl, "COINBASE_API_KEY_ID: ");
  if (!apiKeyId) {
    throw new Error("COINBASE_API_KEY_ID is required");
  }

  const apiKeySecret = await ask(rl, "COINBASE_API_KEY_SECRET: ");
  if (!apiKeySecret) {
    throw new Error("COINBASE_API_KEY_SECRET is required");
  }

  const walletSecret = await ask(rl, "COINBASE_WALLET_SECRET: ");
  if (!walletSecret) {
    throw new Error("COINBASE_WALLET_SECRET is required");
  }

  // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
  console.error("\nOptional settings (press Enter to skip):\n");

  const nwcConnectionString = await ask(
    rl,
    "NWC_CONNECTION_STRING (enables L402 Lightning, optional): ",
  );
  const dailyBudget = await ask(rl, "BOLTZPAY_DAILY_BUDGET (e.g. 5.00): ");

  return {
    COINBASE_API_KEY_ID: apiKeyId,
    COINBASE_API_KEY_SECRET: apiKeySecret,
    COINBASE_WALLET_SECRET: walletSecret,
    NWC_CONNECTION_STRING: nwcConnectionString || undefined,
    BOLTZPAY_DAILY_BUDGET: dailyBudget || undefined,
  };
}

function buildServerEntry(credentials: Credentials): Record<string, unknown> {
  const env: Record<string, string> = {
    COINBASE_API_KEY_ID: credentials.COINBASE_API_KEY_ID,
    COINBASE_API_KEY_SECRET: credentials.COINBASE_API_KEY_SECRET,
    COINBASE_WALLET_SECRET: credentials.COINBASE_WALLET_SECRET,
  };

  if (credentials.NWC_CONNECTION_STRING) {
    env.NWC_CONNECTION_STRING = credentials.NWC_CONNECTION_STRING;
  }

  if (credentials.BOLTZPAY_DAILY_BUDGET) {
    env.BOLTZPAY_DAILY_BUDGET = credentials.BOLTZPAY_DAILY_BUDGET;
  }

  if (platform() === "win32") {
    return { command: "cmd", args: ["/c", "npx", "-y", "@boltzpay/mcp"], env };
  }

  return { command: "npx", args: ["-y", "@boltzpay/mcp"], env };
}

function writeClaudeDesktopConfig(
  configPath: string,
  config: Record<string, unknown>,
  serverEntry: Record<string, unknown>,
): void {
  const mcpServersRaw: unknown = config.mcpServers ?? {};
  const mcpServers = isPlainObject(mcpServersRaw) ? mcpServersRaw : {};
  mcpServers.boltzpay = serverEntry;
  config.mcpServers = mcpServers;

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");

  if (platform() !== "win32") {
    chmodSync(configPath, 0o600);
  }

  // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
  console.error(
    `Warning: API keys stored in plaintext at ${configPath}. Restrict file permissions.`,
  );
}

export async function runSetup(): Promise<void> {
  const configPath = getConfigPath();
  // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
  console.error(`Claude Desktop config: ${configPath}`);

  let config = readExistingConfig(configPath);

  if (config === null) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    const answer = await ask(
      rl,
      "\nExisting config file could not be parsed. Overwrite? (y/N): ",
    );
    rl.close();

    if (answer.toLowerCase() !== "y") {
      // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
      console.error("Setup cancelled.");
      process.exitCode = 1;
      return;
    }
    config = {};
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });

  try {
    const credentials = await promptCredentials(rl);
    const serverEntry = buildServerEntry(credentials);
    writeClaudeDesktopConfig(configPath, config, serverEntry);

    // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
    console.error("\nBoltzPay MCP server configured for Claude Desktop");
    // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
    console.error(`Config written to: ${configPath}`);
    // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs to stderr
    console.error("\nRestart Claude Desktop to activate.");
  } finally {
    rl.close();
  }
}

export {
  getConfigPath,
  readExistingConfig,
  buildServerEntry,
  writeClaudeDesktopConfig,
};
