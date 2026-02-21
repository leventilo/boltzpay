import { SUPPORTED_NAMESPACES } from "@boltzpay/core";
import { z } from "zod";
import { ConfigurationError } from "../errors/configuration-error";

const NETWORK = ["base", "base-sepolia"] as const;
const LOG_LEVEL = ["debug", "info", "warn", "error", "silent"] as const;

const DEFAULT_WARNING_THRESHOLD = 0.8;

const positiveAmount = z.union([
  z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a dollar amount like '10.50'"),
  z.number().positive(),
]);

const DEFAULT_SAT_TO_USD_RATE = 0.001;

export const BudgetSchema = z.object({
  daily: positiveAmount.optional(),
  monthly: positiveAmount.optional(),
  perTransaction: positiveAmount.optional(),
  warningThreshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(DEFAULT_WARNING_THRESHOLD),
  /** Conversion rate: 1 sat = X USD. Default 0.001 (~$100K/BTC). Used to count L402 sats in the USD budget. */
  satToUsdRate: z
    .number()
    .positive()
    .optional()
    .default(DEFAULT_SAT_TO_USD_RATE),
});

export const PersistenceSchema = z.object({
  enabled: z.boolean().optional().default(false),
  directory: z.string().optional(),
  historyMaxRecords: z.number().int().positive().optional().default(500),
});

export const BoltzPayConfigSchema = z.object({
  coinbaseApiKeyId: z.string().min(1).optional(),
  coinbaseApiKeySecret: z.string().min(1).optional(),
  coinbaseWalletSecret: z.string().min(1).optional(),
  nwcConnectionString: z
    .string()
    .startsWith("nostr+walletconnect://")
    .optional(),
  network: z.enum(NETWORK).optional().default("base"),
  preferredChains: z.array(z.enum(SUPPORTED_NAMESPACES)).optional(),
  budget: BudgetSchema.optional(),
  persistence: PersistenceSchema.optional(),
  logLevel: z.enum(LOG_LEVEL).optional().default("warn"),
});

function formatZodIssues(issues: ReadonlyArray<z.core.$ZodIssue>): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${path}: ${issue.message}`;
    })
    .join("\n");
}

export function validateConfig(
  input: unknown,
): z.output<typeof BoltzPayConfigSchema> {
  const result = BoltzPayConfigSchema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  throw new ConfigurationError(
    "invalid_config",
    `Invalid BoltzPay configuration:\n${formatZodIssues(result.error.issues)}`,
  );
}

export function hasCoinbaseCredentials(
  config: z.output<typeof BoltzPayConfigSchema>,
): config is z.output<typeof BoltzPayConfigSchema> & {
  coinbaseApiKeyId: string;
  coinbaseApiKeySecret: string;
  coinbaseWalletSecret: string;
} {
  return !!(
    config.coinbaseApiKeyId &&
    config.coinbaseApiKeySecret &&
    config.coinbaseWalletSecret
  );
}
