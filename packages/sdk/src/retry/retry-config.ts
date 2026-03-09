import { z } from "zod";

export const RetrySchema = z.object({
  maxRetries: z.number().int().min(0).optional().default(3),
  backoffMs: z.number().int().positive().optional().default(200),
});

export const RateLimitStrategySchema = z
  .enum(["wait", "error", "passthrough"])
  .optional()
  .default("wait");

export const RateLimitSchema = z.object({
  strategy: RateLimitStrategySchema,
  maxWaitMs: z.number().int().positive().optional().default(60_000),
});

export type RetryConfig = z.output<typeof RetrySchema>;
export type RateLimitConfig = z.output<typeof RateLimitSchema>;
export type RateLimitStrategy = z.output<typeof RateLimitStrategySchema>;
