import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import { BoltzPayError } from "../../src/errors/boltzpay-error";
import { BudgetExceededError } from "../../src/errors/budget-exceeded-error";
import { ConfigurationError } from "../../src/errors/configuration-error";
import { InsufficientFundsError } from "../../src/errors/insufficient-funds-error";
import { NetworkError } from "../../src/errors/network-error";
import { ProtocolError } from "../../src/errors/protocol-error";

describe("BoltzPayError", () => {
  it("is abstract and cannot be instantiated directly", () => {
    // BoltzPayError has abstract members — TypeScript prevents direct construction.
    // At runtime we verify it only exists through subclasses.
    expect(BoltzPayError).toBeDefined();
    // All subclasses are instanceof BoltzPayError
    const err = new ConfigurationError("invalid_config", "test");
    expect(err).toBeInstanceOf(BoltzPayError);
  });
});

describe("ConfigurationError", () => {
  it('has code "missing_coinbase_credentials" and statusCode 400', () => {
    const err = new ConfigurationError(
      "missing_coinbase_credentials",
      "Missing credentials",
    );
    expect(err.code).toBe("missing_coinbase_credentials");
    expect(err.statusCode).toBe(400);
  });

  it('has code "invalid_config" and statusCode 400', () => {
    const err = new ConfigurationError("invalid_config", "Bad config");
    expect(err.code).toBe("invalid_config");
    expect(err.statusCode).toBe(400);
  });

  it("is instanceof BoltzPayError and Error", () => {
    const err = new ConfigurationError("invalid_config", "test");
    expect(err).toBeInstanceOf(BoltzPayError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "ConfigurationError"', () => {
    const err = new ConfigurationError("invalid_config", "test");
    expect(err.name).toBe("ConfigurationError");
  });
});

describe("BudgetExceededError", () => {
  const requested = Money.fromDollars("10.00");
  const limit = Money.fromDollars("5.00");

  it('has code "daily_budget_exceeded" and statusCode 429', () => {
    const err = new BudgetExceededError(
      "daily_budget_exceeded",
      requested,
      limit,
    );
    expect(err.code).toBe("daily_budget_exceeded");
    expect(err.statusCode).toBe(429);
  });

  it('has code "monthly_budget_exceeded" and statusCode 429', () => {
    const err = new BudgetExceededError(
      "monthly_budget_exceeded",
      requested,
      limit,
    );
    expect(err.code).toBe("monthly_budget_exceeded");
    expect(err.statusCode).toBe(429);
  });

  it('has code "per_transaction_exceeded" and statusCode 429', () => {
    const err = new BudgetExceededError(
      "per_transaction_exceeded",
      requested,
      limit,
    );
    expect(err.code).toBe("per_transaction_exceeded");
    expect(err.statusCode).toBe(429);
  });

  it("exposes requested and limit Money values", () => {
    const err = new BudgetExceededError(
      "daily_budget_exceeded",
      requested,
      limit,
    );
    expect(err.requested.equals(requested)).toBe(true);
    expect(err.limit.equals(limit)).toBe(true);
  });

  it("message includes Money display strings", () => {
    const err = new BudgetExceededError(
      "daily_budget_exceeded",
      requested,
      limit,
    );
    expect(err.message).toContain("$10.00");
    expect(err.message).toContain("$5.00");
  });

  it("is instanceof BoltzPayError and Error", () => {
    const err = new BudgetExceededError(
      "daily_budget_exceeded",
      requested,
      limit,
    );
    expect(err).toBeInstanceOf(BoltzPayError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "BudgetExceededError"', () => {
    const err = new BudgetExceededError(
      "daily_budget_exceeded",
      requested,
      limit,
    );
    expect(err.name).toBe("BudgetExceededError");
  });
});

describe("ProtocolError", () => {
  it.each([
    "protocol_detection_failed",
    "protocol_not_supported",
    "payment_failed",
  ] as const)('has code "%s" and statusCode 502', (code) => {
    const err = new ProtocolError(code, `Test ${code}`);
    expect(err.code).toBe(code);
    expect(err.statusCode).toBe(502);
  });

  it("is instanceof BoltzPayError and Error", () => {
    const err = new ProtocolError("payment_failed", "test");
    expect(err).toBeInstanceOf(BoltzPayError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "ProtocolError"', () => {
    const err = new ProtocolError("payment_failed", "test");
    expect(err.name).toBe("ProtocolError");
  });

  it("has undefined diagnosis by default", () => {
    const err = new ProtocolError("payment_failed", "test");
    expect(err.diagnosis).toBeUndefined();
  });

  it("accepts optional DeliveryDiagnosis", () => {
    const diagnosis = {
      phase: "delivery" as const,
      paymentSent: true,
      serverStatus: 401,
      serverMessage: "API key required",
      suggestion: "Server requires additional authentication.",
    };
    const err = new ProtocolError("payment_failed", "test", diagnosis);
    expect(err.diagnosis).toBeDefined();
    expect(err.diagnosis!.phase).toBe("delivery");
    expect(err.diagnosis!.paymentSent).toBe(true);
    expect(err.diagnosis!.serverStatus).toBe(401);
    expect(err.diagnosis!.serverMessage).toBe("API key required");
    expect(err.diagnosis!.suggestion).toContain("authentication");
  });

  it("diagnosis is backward compatible — existing code still works", () => {
    const err = new ProtocolError("payment_failed", "old usage");
    expect(err.code).toBe("payment_failed");
    expect(err.message).toBe("old usage");
    expect(err.diagnosis).toBeUndefined();
  });
});

describe("NetworkError", () => {
  it.each([
    "network_timeout",
    "endpoint_unreachable",
    "blockchain_error",
  ] as const)('has code "%s" and statusCode 503', (code) => {
    const err = new NetworkError(code, `Test ${code}`);
    expect(err.code).toBe(code);
    expect(err.statusCode).toBe(503);
  });

  it("is instanceof BoltzPayError and Error", () => {
    const err = new NetworkError("blockchain_error", "test");
    expect(err).toBeInstanceOf(BoltzPayError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "NetworkError"', () => {
    const err = new NetworkError("blockchain_error", "test");
    expect(err.name).toBe("NetworkError");
  });
});

describe("InsufficientFundsError", () => {
  it.each([
    "insufficient_usdc",
    "insufficient_lightning_balance",
  ] as const)('has code "%s" and statusCode 402', (code) => {
    const err = new InsufficientFundsError(code, `Test ${code}`);
    expect(err.code).toBe(code);
    expect(err.statusCode).toBe(402);
  });

  it("is instanceof BoltzPayError and Error", () => {
    const err = new InsufficientFundsError("insufficient_usdc", "test");
    expect(err).toBeInstanceOf(BoltzPayError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "InsufficientFundsError"', () => {
    const err = new InsufficientFundsError("insufficient_usdc", "test");
    expect(err.name).toBe("InsufficientFundsError");
  });
});
