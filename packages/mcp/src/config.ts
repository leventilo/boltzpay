import "dotenv/config";
import { BoltzPay } from "@boltzpay/sdk";

function parseLogLevel(
  value: string | undefined,
): "debug" | "info" | "warn" | "error" | "silent" | undefined {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "silent"
  )
    return value;
  return undefined;
}

function parseNetwork(
  value: string | undefined,
): "base" | "base-sepolia" | undefined {
  if (value === "base" || value === "base-sepolia") return value;
  return undefined;
}

const COINBASE_KEYS = [
  "COINBASE_API_KEY_ID",
  "COINBASE_API_KEY_SECRET",
  "COINBASE_WALLET_SECRET",
] as const;

function warnPartialCredentials(): void {
  const present = COINBASE_KEYS.filter((k) => !!process.env[k]);
  if (present.length > 0 && present.length < COINBASE_KEYS.length) {
    const missing = COINBASE_KEYS.filter((k) => !process.env[k]);
    // biome-ignore lint/suspicious/noConsole: MCP server intentionally outputs warnings to stderr
    console.error(
      `[boltzpay-mcp] Warning: partial Coinbase credentials — ${missing.join(", ")} missing. All 3 are required for payments.`,
    );
  }
}

export function createSdkFromEnv(): BoltzPay {
  warnPartialCredentials();

  const dailyBudget = process.env.BOLTZPAY_DAILY_BUDGET;
  const monthlyBudget = process.env.BOLTZPAY_MONTHLY_BUDGET;
  const perTransaction = process.env.BOLTZPAY_PER_TRANSACTION;
  const budget =
    dailyBudget || monthlyBudget || perTransaction
      ? { daily: dailyBudget, monthly: monthlyBudget, perTransaction }
      : undefined;

  return new BoltzPay({
    coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID || undefined,
    coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET || undefined,
    coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET || undefined,
    nwcConnectionString: process.env.NWC_CONNECTION_STRING || undefined,
    budget,
    logLevel: parseLogLevel(process.env.BOLTZPAY_LOG_LEVEL),
    network: parseNetwork(process.env.BOLTZPAY_NETWORK),
  });
}
