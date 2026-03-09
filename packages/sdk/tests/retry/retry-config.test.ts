import { describe, expect, it } from "vitest";
import { RetrySchema, RateLimitSchema } from "../../src/retry/retry-config";
import { BoltzPayConfigSchema } from "../../src/config/schema";

describe("RetrySchema", () => {
  it("applies correct defaults", () => {
    const result = RetrySchema.parse({});
    expect(result).toEqual({ maxRetries: 3, backoffMs: 200 });
  });

  it("accepts custom values", () => {
    const result = RetrySchema.parse({ maxRetries: 5, backoffMs: 500 });
    expect(result).toEqual({ maxRetries: 5, backoffMs: 500 });
  });

  it("rejects negative maxRetries", () => {
    expect(() => RetrySchema.parse({ maxRetries: -1 })).toThrow();
  });

  it("rejects zero backoffMs", () => {
    expect(() => RetrySchema.parse({ backoffMs: 0 })).toThrow();
  });

  it("rejects negative backoffMs", () => {
    expect(() => RetrySchema.parse({ backoffMs: -100 })).toThrow();
  });

  it("accepts maxRetries=0 (fail-fast mode)", () => {
    const result = RetrySchema.parse({ maxRetries: 0 });
    expect(result.maxRetries).toBe(0);
  });
});

describe("RateLimitSchema", () => {
  it("applies correct defaults", () => {
    const result = RateLimitSchema.parse({});
    expect(result).toEqual({ strategy: "wait", maxWaitMs: 60_000 });
  });

  it("accepts strategy=error", () => {
    const result = RateLimitSchema.parse({ strategy: "error" });
    expect(result.strategy).toBe("error");
  });

  it("accepts strategy=passthrough", () => {
    const result = RateLimitSchema.parse({ strategy: "passthrough" });
    expect(result.strategy).toBe("passthrough");
  });

  it("rejects invalid strategy", () => {
    expect(() => RateLimitSchema.parse({ strategy: "invalid" })).toThrow();
  });

  it("accepts custom maxWaitMs", () => {
    const result = RateLimitSchema.parse({ maxWaitMs: 120_000 });
    expect(result.maxWaitMs).toBe(120_000);
  });
});

describe("BoltzPayConfigSchema with retry and rateLimit", () => {
  it("validates with retry and rateLimit config", () => {
    const result = BoltzPayConfigSchema.parse({
      retry: { maxRetries: 5, backoffMs: 500 },
      rateLimit: { strategy: "error", maxWaitMs: 30_000 },
    });
    expect(result.retry).toEqual({ maxRetries: 5, backoffMs: 500 });
    expect(result.rateLimit).toEqual({ strategy: "error", maxWaitMs: 30_000 });
  });

  it("validates without retry/rateLimit (backward compatible)", () => {
    const result = BoltzPayConfigSchema.parse({});
    expect(result.retry).toBeUndefined();
    expect(result.rateLimit).toBeUndefined();
  });

  it("applies defaults within retry and rateLimit", () => {
    const result = BoltzPayConfigSchema.parse({
      retry: {},
      rateLimit: {},
    });
    expect(result.retry).toEqual({ maxRetries: 3, backoffMs: 200 });
    expect(result.rateLimit).toEqual({ strategy: "wait", maxWaitMs: 60_000 });
  });
});
