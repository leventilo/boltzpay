import { describe, expect, it, vi } from "vitest";
import { NetworkError } from "../../src/errors/network-error";
import { BudgetExceededError } from "../../src/errors/budget-exceeded-error";
import { ConfigurationError } from "../../src/errors/configuration-error";
import { InsufficientFundsError } from "../../src/errors/insufficient-funds-error";
import { PaymentUncertainError } from "../../src/errors/payment-uncertain-error";
import { RateLimitError } from "../../src/errors/rate-limit-error";
import {
  withRetry,
  calculateDelay,
  parseRetryAfter,
  type RetryOptions,
} from "../../src/retry/retry-engine";
import { Money } from "@boltzpay/core";

function makeOptions(overrides: Partial<RetryOptions> = {}): RetryOptions {
  return {
    maxRetries: 3,
    backoffMs: 1, // 1ms for fast tests
    rateLimitStrategy: "wait",
    maxRateLimitWaitMs: 60_000,
    phase: "detect",
    ...overrides,
  };
}

function mockEmitter() {
  return { emit: vi.fn().mockReturnValue(true) } as unknown as RetryOptions["emitter"];
}

describe("withRetry — basic behavior", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, makeOptions());
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries on NetworkError and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError("network_timeout", "timeout"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, makeOptions());
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries and throws last error", async () => {
    const error = new NetworkError("network_timeout", "always fails");
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn, makeOptions({ maxRetries: 2 }))).rejects.toThrow(
      "always fails",
    );
    // initial + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry with maxRetries=0", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new NetworkError("network_timeout", "fail"));
    await expect(withRetry(fn, makeOptions({ maxRetries: 0 }))).rejects.toThrow(
      "fail",
    );
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("withRetry — isRetryable filtering", () => {
  it("does not retry BudgetExceededError", async () => {
    const fn = vi.fn().mockRejectedValue(
      new BudgetExceededError(
        "daily_budget_exceeded",
        Money.fromDollars("10.00"),
        Money.fromDollars("5.00"),
      ),
    );
    await expect(withRetry(fn, makeOptions())).rejects.toThrow("Budget exceeded");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does not retry ConfigurationError", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new ConfigurationError("invalid_config", "bad config"));
    await expect(withRetry(fn, makeOptions())).rejects.toThrow("bad config");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does not retry InsufficientFundsError", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(
        new InsufficientFundsError("insufficient_usdc", "no funds"),
      );
    await expect(withRetry(fn, makeOptions())).rejects.toThrow("no funds");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does not retry PaymentUncertainError", async () => {
    const fn = vi.fn().mockRejectedValue(
      new PaymentUncertainError({
        message: "uncertain",
        url: "https://example.com",
        amount: Money.fromDollars("1.00"),
        protocol: "x402",
      }),
    );
    await expect(withRetry(fn, makeOptions())).rejects.toThrow("uncertain");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries on ECONNRESET error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("read ECONNRESET"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, makeOptions());
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on ETIMEDOUT error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("connect ETIMEDOUT"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, makeOptions());
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry unknown errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("some random error"));
    await expect(withRetry(fn, makeOptions())).rejects.toThrow("some random error");
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("withRetry — rate limit handling", () => {
  it("strategy=wait: waits retryAfterMs then retries", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitError("rate limited", 10))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, makeOptions({ rateLimitStrategy: "wait" }));
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("strategy=error: throws immediately on RateLimitError", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new RateLimitError("rate limited", 1000));
    await expect(
      withRetry(fn, makeOptions({ rateLimitStrategy: "error" })),
    ).rejects.toThrow("rate limited");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("strategy=passthrough: throws RateLimitError through", async () => {
    const error = new RateLimitError("rate limited", 1000);
    const fn = vi.fn().mockRejectedValue(error);
    const caught = await withRetry(
      fn,
      makeOptions({ rateLimitStrategy: "passthrough" }),
    ).catch((e: unknown) => e);
    expect(caught).toBe(error);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("strategy=wait: throws when retryAfterMs exceeds maxWaitMs", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new RateLimitError("rate limited", 120_000));
    await expect(
      withRetry(fn, makeOptions({ rateLimitStrategy: "wait", maxRateLimitWaitMs: 60_000 })),
    ).rejects.toThrow("rate limited");
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("withRetry — events", () => {
  it("emits retry:attempt on each retry", async () => {
    const emitter = mockEmitter();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError("network_timeout", "fail"))
      .mockRejectedValueOnce(new NetworkError("network_timeout", "fail"))
      .mockResolvedValue("ok");
    await withRetry(fn, makeOptions({ emitter }));
    const attemptCalls = (emitter!.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === "retry:attempt",
    );
    expect(attemptCalls).toHaveLength(2);
    expect(attemptCalls[0][1]).toMatchObject({
      attempt: 1,
      maxRetries: 3,
      phase: "detect",
    });
    expect(attemptCalls[1][1]).toMatchObject({
      attempt: 2,
      maxRetries: 3,
      phase: "detect",
    });
  });

  it("emits retry:exhausted when retries exhausted", async () => {
    const emitter = mockEmitter();
    const fn = vi
      .fn()
      .mockRejectedValue(new NetworkError("network_timeout", "fail"));
    await withRetry(fn, makeOptions({ maxRetries: 1, emitter })).catch(() => {});
    const exhaustedCalls = (emitter!.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === "retry:exhausted",
    );
    expect(exhaustedCalls).toHaveLength(1);
    expect(exhaustedCalls[0][1]).toMatchObject({
      maxRetries: 1,
      phase: "detect",
    });
  });
});

describe("calculateDelay", () => {
  it("produces exponential values", () => {
    // With controlled random, check ranges
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      delays.push(calculateDelay(200, 0));
    }
    // backoff * 2^0 * [0.5, 1.5] => [100, 300]
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(100);
      expect(d).toBeLessThanOrEqual(300);
    }
  });

  it("delay scales with attempt number", () => {
    const attempt0Delays: number[] = [];
    const attempt2Delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      attempt0Delays.push(calculateDelay(200, 0));
      attempt2Delays.push(calculateDelay(200, 2));
    }
    const avg0 = attempt0Delays.reduce((a, b) => a + b, 0) / attempt0Delays.length;
    const avg2 = attempt2Delays.reduce((a, b) => a + b, 0) / attempt2Delays.length;
    // attempt 2 should be ~4x attempt 0
    expect(avg2).toBeGreaterThan(avg0 * 2);
  });

  it("delay is always at least 50% of base", () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      for (let i = 0; i < 100; i++) {
        const d = calculateDelay(200, attempt);
        expect(d).toBeGreaterThanOrEqual(200 * Math.pow(2, attempt) * 0.5);
      }
    }
  });
});

describe("parseRetryAfter", () => {
  it("parses integer seconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
  });

  it("parses HTTP-date", () => {
    const futureDate = new Date(Date.now() + 10_000).toUTCString();
    const result = parseRetryAfter(futureDate);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(11_000);
  });

  it("returns undefined for null", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("returns undefined for garbage", () => {
    expect(parseRetryAfter("not-a-date")).toBeUndefined();
  });

  it("returns 0 for past HTTP-date", () => {
    const pastDate = new Date(Date.now() - 10_000).toUTCString();
    const result = parseRetryAfter(pastDate);
    expect(result).toBe(0);
  });
});
