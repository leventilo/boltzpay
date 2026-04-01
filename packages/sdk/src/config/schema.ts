import { SUPPORTED_NAMESPACES } from "@boltzpay/core";
import { z } from "zod";
import { ConfigurationError } from "../errors/configuration-error";
import type { StorageAdapter } from "../persistence/storage-adapter";
import { RateLimitSchema, RetrySchema } from "../retry/retry-config";

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

const DEFAULT_DETECT_MS = 10_000;
const DEFAULT_QUOTE_MS = 15_000;
const DEFAULT_PAYMENT_MS = 30_000;

export const TimeoutSchema = z.object({
  detect: z.number().int().positive().default(DEFAULT_DETECT_MS),
  quote: z.number().int().positive().default(DEFAULT_QUOTE_MS),
  payment: z.number().int().positive().default(DEFAULT_PAYMENT_MS),
});

export const StorageSchema = z.union([
  z.literal("file"),
  z.literal("memory"),
  z.object({
    type: z.literal("file"),
    dir: z.string().optional(),
    maxHistoryRecords: z.number().int().positive().optional().default(1000),
  }),
  z.custom<StorageAdapter>(
    (val) =>
      val !== null &&
      typeof val === "object" &&
      "get" in val &&
      "set" in val &&
      "delete" in val &&
      "keys" in val,
    "Must implement StorageAdapter (get, set, delete, keys)",
  ),
]);

const CoinbaseWalletSchema = z.object({
  type: z.literal("coinbase"),
  name: z.string().min(1),
  coinbaseApiKeyId: z.string().min(1),
  coinbaseApiKeySecret: z.string().min(1),
  coinbaseWalletSecret: z.string().min(1),
  networks: z.array(z.string().min(1)).optional(),
});

const NwcWalletSchema = z.object({
  type: z.literal("nwc"),
  name: z.string().min(1),
  nwcConnectionString: z.string().startsWith("nostr+walletconnect://"),
  networks: z.array(z.string().min(1)).optional(),
});

const StripeMppWalletSchema = z.object({
  type: z.literal("stripe-mpp"),
  name: z.string().min(1),
  stripeSecretKey: z.string().min(1),
  networks: z.array(z.string().min(1)).optional(),
});

const TempoWalletSchema = z.object({
  type: z.literal("tempo"),
  name: z.string().min(1),
  tempoPrivateKey: z.string().min(1),
  networks: z.array(z.string().min(1)).optional(),
});

const VisaMppWalletSchema = z.object({
  type: z.literal("visa-mpp"),
  name: z.string().min(1),
  visaJwe: z.string().min(1),
  networks: z.array(z.string().min(1)).optional(),
});

export const WalletSchema = z.discriminatedUnion("type", [
  CoinbaseWalletSchema,
  NwcWalletSchema,
  StripeMppWalletSchema,
  TempoWalletSchema,
  VisaMppWalletSchema,
]);

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
  storage: StorageSchema.optional(),
  logLevel: z.enum(LOG_LEVEL).optional().default("warn"),
  timeouts: TimeoutSchema.default({
    detect: DEFAULT_DETECT_MS,
    quote: DEFAULT_QUOTE_MS,
    payment: DEFAULT_PAYMENT_MS,
  }),
  maxAmountPerRequest: positiveAmount.optional(),
  allowlist: z.array(z.string().min(1)).optional(),
  blocklist: z.array(z.string().min(1)).optional(),
  logFormat: z.enum(["text", "json"]).optional().default("text"),
  retry: RetrySchema.optional(),
  rateLimit: RateLimitSchema.optional(),
  wallets: z.array(WalletSchema).optional(),
  mppPreferredMethods: z.array(z.string().min(1)).optional(),
  registryUrl: z.string().url().optional(),
  sessionMaxDeposit: positiveAmount.optional(),
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
