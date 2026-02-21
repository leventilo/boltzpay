import "dotenv/config";

import { BoltzPay, type BoltzPayConfig } from "@boltzpay/sdk";

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

export function createSdkFromEnv(): BoltzPay {
  const config: BoltzPayConfig = {
    coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID || undefined,
    coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET || undefined,
    coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET || undefined,
    nwcConnectionString: process.env.NWC_CONNECTION_STRING || undefined,
    network: parseNetwork(process.env.BOLTZPAY_NETWORK),
    logLevel: parseLogLevel(process.env.BOLTZPAY_LOG_LEVEL),
  };

  const dailyBudget = process.env.BOLTZPAY_DAILY_BUDGET;
  const monthlyBudget = process.env.BOLTZPAY_MONTHLY_BUDGET;
  const perTransaction = process.env.BOLTZPAY_PER_TRANSACTION;

  if (dailyBudget || monthlyBudget || perTransaction) {
    config.budget = {};
    if (dailyBudget) config.budget.daily = dailyBudget;
    if (monthlyBudget) config.budget.monthly = monthlyBudget;
    if (perTransaction) config.budget.perTransaction = perTransaction;
  }

  return new BoltzPay(config);
}
