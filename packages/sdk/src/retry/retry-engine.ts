import { BudgetExceededError } from "../errors/budget-exceeded-error";
import { ConfigurationError } from "../errors/configuration-error";
import { InsufficientFundsError } from "../errors/insufficient-funds-error";
import { NetworkError } from "../errors/network-error";
import { PaymentUncertainError } from "../errors/payment-uncertain-error";
import { RateLimitError } from "../errors/rate-limit-error";
import type { TypedEventEmitter } from "../events/event-emitter";
import type { Logger } from "../logger/logger";
import type { RateLimitStrategy } from "./retry-config";

export interface RetryOptions {
  maxRetries: number;
  backoffMs: number;
  rateLimitStrategy: RateLimitStrategy;
  maxRateLimitWaitMs: number;
  logger?: Logger;
  emitter?: TypedEventEmitter;
  phase: string;
}

const JITTER_MIN = 0.5;
const JITTER_RANGE = 1.0;
const MS_PER_SECOND = 1000;

const TRANSIENT_ERROR_PATTERNS = [
  "econnreset",
  "econnrefused",
  "etimedout",
  "epipe",
  "enotfound",
  "fetch failed",
  "network error",
];

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxRetries, backoffMs, logger, emitter, phase } = options;

  let lastError: Error = new Error("retry exhausted with no attempts");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      if (isRateLimitError(error)) {
        const action = await handleRateLimit(
          error as RateLimitError,
          attempt,
          options,
        );
        if (action === "throw" || action === "passthrough") {
          throw error;
        }
        continue;
      }

      if (!isRetryable(error)) {
        throw error;
      }

      if (attempt === maxRetries) {
        break;
      }

      const delay = calculateDelay(backoffMs, attempt);

      emitter?.emit("retry:attempt", {
        attempt: attempt + 1,
        maxRetries,
        delay,
        phase,
        error,
      });

      logger?.info(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms`, {
        error: error.message,
      });

      await sleep(delay);
    }
  }

  emitter?.emit("retry:exhausted", {
    maxRetries,
    phase,
    error: lastError,
  });

  throw lastError;
}

function isRateLimitError(error: Error): error is RateLimitError {
  return error instanceof RateLimitError;
}

function isRetryable(error: Error): boolean {
  if (error instanceof BudgetExceededError) return false;
  if (error instanceof ConfigurationError) return false;
  if (error instanceof InsufficientFundsError) return false;
  if (error instanceof PaymentUncertainError) return false;

  if (error instanceof NetworkError) return true;

  const msg = error.message.toLowerCase();

  if (TRANSIENT_ERROR_PATTERNS.some((p) => msg.includes(p))) return true;

  if (msg.includes("abort") && msg.includes("timeout")) return true;

  return false;
}

async function handleRateLimit(
  error: RateLimitError,
  _attempt: number,
  options: RetryOptions,
): Promise<"retry" | "throw" | "passthrough"> {
  const { rateLimitStrategy, maxRateLimitWaitMs, backoffMs, logger } = options;

  if (rateLimitStrategy === "error") {
    return "throw";
  }

  if (rateLimitStrategy === "passthrough") {
    return "passthrough";
  }

  const waitMs = error.retryAfterMs;

  if (waitMs !== undefined && waitMs > maxRateLimitWaitMs) {
    logger?.warn(
      `Retry-After ${waitMs}ms exceeds maxWaitMs ${maxRateLimitWaitMs}ms, throwing`,
    );
    return "throw";
  }

  const actualWait = waitMs ?? backoffMs;
  logger?.info(`Rate limited, waiting ${actualWait}ms`);
  await sleep(actualWait);
  return "retry";
}

export function calculateDelay(backoffMs: number, attempt: number): number {
  return Math.round(
    backoffMs * 2 ** attempt * (JITTER_MIN + Math.random() * JITTER_RANGE),
  );
}

export function parseRetryAfter(
  headerValue: string | null,
): number | undefined {
  if (headerValue === null || headerValue.trim() === "") {
    return undefined;
  }

  const seconds = parseInt(headerValue, 10);
  if (
    !Number.isNaN(seconds) &&
    seconds >= 0 &&
    String(seconds) === headerValue.trim()
  ) {
    return seconds * MS_PER_SECOND;
  }

  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
