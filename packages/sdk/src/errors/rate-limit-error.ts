import { BoltzPayError } from "./boltzpay-error";

type RateLimitErrorCode = "rate_limited";

export class RateLimitError extends BoltzPayError {
  readonly code: RateLimitErrorCode = "rate_limited";
  readonly statusCode = 429;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}
