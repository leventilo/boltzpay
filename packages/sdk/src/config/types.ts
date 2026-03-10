import type { z } from "zod";
import type {
  BoltzPayConfigSchema,
  BudgetSchema,
  StorageSchema,
  WalletSchema,
} from "./schema";

export type BoltzPayConfig = z.input<typeof BoltzPayConfigSchema>;

export type ValidatedConfig = z.output<typeof BoltzPayConfigSchema>;

export type BudgetConfig = z.input<typeof BudgetSchema>;

export type StorageConfig = z.input<typeof StorageSchema>;

export type WalletConfig = z.input<typeof WalletSchema>;
