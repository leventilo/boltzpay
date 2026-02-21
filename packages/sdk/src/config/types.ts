import type { z } from "zod";
import type { BoltzPayConfigSchema, BudgetSchema } from "./schema";

/** Configuration object passed to `new BoltzPay()`. Validated at construction time. */
export type BoltzPayConfig = z.input<typeof BoltzPayConfigSchema>;

/** Validated and normalized configuration after Zod parsing. */
export type ValidatedConfig = z.output<typeof BoltzPayConfigSchema>;

/** Budget configuration subset of `BoltzPayConfig`. Limits are in dollars (string or number). */
export type BudgetConfig = z.input<typeof BudgetSchema>;
