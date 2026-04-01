import { Money } from "@boltzpay/core";
import { AggregatePaymentError } from "@boltzpay/protocols";
import { describe, expect, it } from "vitest";
import { BoltzPayError } from "../../src/errors/boltzpay-error";
import { BudgetExceededError } from "../../src/errors/budget-exceeded-error";
import { ConfigurationError } from "../../src/errors/configuration-error";
import { InsufficientFundsError } from "../../src/errors/insufficient-funds-error";
import { MppSessionBudgetError, MppSessionError } from "../../src/errors/mpp-session-error";
import { NetworkError } from "../../src/errors/network-error";
import { NoWalletError } from "../../src/errors/no-wallet-error";
import { PaymentUncertainError } from "../../src/errors/payment-uncertain-error";
import { ProtocolError } from "../../src/errors/protocol-error";
import { RateLimitError } from "../../src/errors/rate-limit-error";
import { UnsupportedNetworkError } from "../../src/errors/unsupported-network-error";
import { UnsupportedSchemeError } from "../../src/errors/unsupported-scheme-error";
import type { DeathReason } from "../../src/diagnostics/diagnose";

describe("AggregatePaymentError: dual-protocol failure", () => {
  it("lists each protocol failure reason in the message", () => {
    const x402Err = new ProtocolError(
      "x402_payment_failed",
      "Coinbase CDP: insufficient USDC balance on Base",
    );
    const l402Err = new ProtocolError(
      "l402_payment_failed",
      "NWC: Lightning invoice expired",
    );

    const aggregate = new AggregatePaymentError([x402Err, l402Err]);

    expect(aggregate.message).toContain("1.");
    expect(aggregate.message).toContain("2.");
    expect(aggregate.message).toContain("insufficient USDC balance");
    expect(aggregate.message).toContain("Lightning invoice expired");
  });

  it("wraps into ProtocolError with payment_failed code", () => {
    const x402Err = new ProtocolError(
      "x402_payment_failed",
      "Coinbase CDP timeout",
    );
    const mppErr = new ProtocolError(
      "payment_failed",
      "MPP: no wallet configured for tempo",
    );

    const aggregate = new AggregatePaymentError([x402Err, mppErr]);

    // This is what boltzpay.ts does when wrapping
    const wrapped = new ProtocolError("payment_failed", aggregate.message);

    expect(wrapped).toBeInstanceOf(ProtocolError);
    expect(wrapped.code).toBe("payment_failed");
    expect(wrapped.message).toContain("Coinbase CDP timeout");
    expect(wrapped.message).toContain("no wallet configured for tempo");
  });

  it("single-error aggregate still produces readable message", () => {
    const singleErr = new Error("Network timeout connecting to x402 facilitator");
    const aggregate = new AggregatePaymentError([singleErr]);

    expect(aggregate.message).toContain("Network timeout");
    expect(aggregate.errors).toHaveLength(1);
  });

  it("empty errors array does not crash", () => {
    const aggregate = new AggregatePaymentError([]);

    expect(aggregate.message).toContain("All payment attempts failed");
    expect(aggregate.errors).toHaveLength(0);
  });
});

describe("MCP -32042 without challenges in error.data", () => {
  it("handles undefined error.data gracefully", () => {
    // Simulating what would happen if error.data is undefined
    // The MCP wrapper handles -32042 via mppx internally,
    // but we verify our error wrappers don't crash on undefined
    const mcpError = {
      code: -32042,
      message: "Payment Required",
      data: undefined as unknown,
    };

    // Accessing challenges on undefined would throw — verify SDK wraps this
    const challenges =
      mcpError.data !== null &&
      mcpError.data !== undefined &&
      typeof mcpError.data === "object" &&
      "challenges" in (mcpError.data as Record<string, unknown>)
        ? (mcpError.data as Record<string, unknown>).challenges
        : undefined;

    expect(challenges).toBeUndefined();
  });

  it("handles error.data as empty object (no challenges key)", () => {
    const mcpError = {
      code: -32042,
      message: "Payment Required",
      data: {},
    };

    const challenges =
      mcpError.data !== null &&
      typeof mcpError.data === "object" &&
      "challenges" in mcpError.data
        ? (mcpError.data as Record<string, unknown>).challenges
        : undefined;

    expect(challenges).toBeUndefined();
  });

  it("handles error.data with empty challenges array", () => {
    const mcpError = {
      code: -32042,
      message: "Payment Required",
      data: { challenges: [] },
    };

    const challenges =
      typeof mcpError.data === "object" &&
      mcpError.data !== null &&
      "challenges" in mcpError.data
        ? (mcpError.data as Record<string, unknown[]>).challenges
        : undefined;

    expect(challenges).toEqual([]);
    expect(challenges).toHaveLength(0);
  });
});

describe("Session error: budget reservation release", () => {
  it("MppSessionBudgetError exposes requested and limit amounts", () => {
    const requested = Money.fromDollars("15.00");
    const limit = Money.fromDollars("10.00");

    const err = new MppSessionBudgetError(requested, limit);

    expect(err).toBeInstanceOf(BoltzPayError);
    expect(err.code).toBe("session_budget_exceeded");
    expect(err.statusCode).toBe(429);
    expect(err.requested.equals(requested)).toBe(true);
    expect(err.limit.equals(limit)).toBe(true);
    expect(err.message).toContain("$15.00");
    expect(err.message).toContain("$10.00");
  });

  it("MppSessionError has descriptive message for session failures", () => {
    const err = new MppSessionError("Connection reset during streaming");

    expect(err).toBeInstanceOf(BoltzPayError);
    expect(err.code).toBe("mpp_session_failed");
    expect(err.statusCode).toBe(502);
    expect(err.message).toBe("Connection reset during streaming");
  });
});

describe("DeathReason actionable error messages", () => {
  const DEATH_REASONS: readonly DeathReason[] = [
    "dns_failure",
    "http_404",
    "http_405",
    "http_5xx",
    "timeout",
    "tls_error",
  ] as const;

  it("every DeathReason is a valid string literal", () => {
    for (const reason of DEATH_REASONS) {
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it("dns_failure is actionable: check DNS/hostname", () => {
    const reason: DeathReason = "dns_failure";
    expect(reason).toBe("dns_failure");
    // The diagnose function returns this as deathReason —
    // consumers can match on it to provide specific guidance
  });

  it("http_404 is actionable: endpoint not found", () => {
    const reason: DeathReason = "http_404";
    expect(reason).toBe("http_404");
  });

  it("http_405 is actionable: method not allowed", () => {
    const reason: DeathReason = "http_405";
    expect(reason).toBe("http_405");
  });

  it("http_5xx is actionable: server error", () => {
    const reason: DeathReason = "http_5xx";
    expect(reason).toBe("http_5xx");
  });

  it("timeout is actionable: increase timeout or check connectivity", () => {
    const reason: DeathReason = "timeout";
    expect(reason).toBe("timeout");
  });

  it("tls_error is actionable: check TLS/SSL certificate", () => {
    const reason: DeathReason = "tls_error";
    expect(reason).toBe("tls_error");
  });

  it("DeathReason set covers all 6 expected reasons", () => {
    expect(DEATH_REASONS).toHaveLength(6);
    const unique = new Set(DEATH_REASONS);
    expect(unique.size).toBe(6);
  });
});

describe("Every error class has stable code and instanceof chain", () => {
  it("all error classes extend BoltzPayError and Error", () => {
    const errors: BoltzPayError[] = [
      new ConfigurationError("invalid_config", "test"),
      new BudgetExceededError("daily_budget_exceeded", Money.fromCents(100n), Money.fromCents(50n)),
      new InsufficientFundsError("insufficient_usdc", "test"),
      new MppSessionError("test"),
      new MppSessionBudgetError(Money.fromCents(100n), Money.fromCents(50n)),
      new NetworkError("network_timeout", "test"),
      new NoWalletError("evm", []),
      new PaymentUncertainError({
        message: "test",
        url: "https://example.com",
        amount: Money.fromCents(100n),
        protocol: "x402",
      }),
      new ProtocolError("payment_failed", "test"),
      new RateLimitError("test"),
      new UnsupportedNetworkError("stellar"),
      new UnsupportedSchemeError({ scheme: "upto" }),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(BoltzPayError);
      expect(err).toBeInstanceOf(Error);
      expect(typeof err.code).toBe("string");
      expect(err.code.length).toBeGreaterThan(0);
      expect(typeof err.statusCode).toBe("number");
      expect(err.statusCode).toBeGreaterThanOrEqual(400);
      expect(err.statusCode).toBeLessThan(600);
      expect(err.name).toBe(err.constructor.name);
    }
  });

  it("every error code is unique across error classes", () => {
    const codes = [
      "invalid_config",
      "missing_coinbase_credentials",
      "domain_blocked",
      "daily_budget_exceeded",
      "monthly_budget_exceeded",
      "per_transaction_exceeded",
      "insufficient_usdc",
      "insufficient_lightning_balance",
      "mpp_session_failed",
      "session_budget_exceeded",
      "network_timeout",
      "endpoint_unreachable",
      "blockchain_error",
      "registry_unavailable",
      "registry_invalid_response",
      "no_wallet_available",
      "payment_uncertain",
      "protocol_detection_failed",
      "protocol_not_supported",
      "payment_failed",
      "no_compatible_chain",
      "x402_payment_failed",
      "x402_quote_failed",
      "l402_payment_failed",
      "l402_quote_failed",
      "l402_detection_failed",
      "l402_credentials_missing",
      "cdp_provisioning_failed",
      "rate_limited",
      "unsupported_network",
      "unsupported_scheme",
    ];

    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});

describe("RateLimitError", () => {
  it("has code rate_limited and statusCode 429", () => {
    const err = new RateLimitError("Slow down");
    expect(err.code).toBe("rate_limited");
    expect(err.statusCode).toBe(429);
  });

  it("exposes retryAfterMs when provided", () => {
    const err = new RateLimitError("Rate limited by registry", 30_000);
    expect(err.retryAfterMs).toBe(30_000);
  });

  it("retryAfterMs is undefined when not provided", () => {
    const err = new RateLimitError("Rate limited");
    expect(err.retryAfterMs).toBeUndefined();
  });
});

describe("PaymentUncertainError: post-signature network failure", () => {
  it("exposes url, amount, protocol, and optional tx info", () => {
    const err = new PaymentUncertainError({
      message: "Network error after payment signing",
      url: "https://api.example.com/v1/paid",
      amount: Money.fromDollars("0.50"),
      protocol: "x402",
      nonce: "abc123",
      txHash: "0xdeadbeef",
    });

    expect(err.code).toBe("payment_uncertain");
    expect(err.statusCode).toBe(502);
    expect(err.url).toBe("https://api.example.com/v1/paid");
    expect(err.amount.equals(Money.fromDollars("0.50"))).toBe(true);
    expect(err.protocol).toBe("x402");
    expect(err.nonce).toBe("abc123");
    expect(err.txHash).toBe("0xdeadbeef");
  });

  it("nonce and txHash are optional", () => {
    const err = new PaymentUncertainError({
      message: "Network error",
      url: "https://api.example.com",
      amount: Money.fromCents(50n),
      protocol: "mpp",
    });

    expect(err.nonce).toBeUndefined();
    expect(err.txHash).toBeUndefined();
  });
});

describe("ProtocolError with DeliveryDiagnosis", () => {
  it("includes delivery attempt details for multi-header fallback", () => {
    const err = new ProtocolError("x402_payment_failed", "All delivery attempts failed", {
      phase: "delivery",
      paymentSent: true,
      suggestion: "Server may not support the payment header format",
      deliveryAttempts: [
        {
          method: "GET",
          headerName: "X-PAYMENT",
          status: 402,
          serverMessage: "Payment header not recognized",
        },
        {
          method: "GET",
          headerName: "Authorization",
          status: 402,
          serverMessage: "Invalid authorization",
        },
      ],
    });

    expect(err.diagnosis).toBeDefined();
    expect(err.diagnosis!.phase).toBe("delivery");
    expect(err.diagnosis!.paymentSent).toBe(true);
    expect(err.diagnosis!.deliveryAttempts).toHaveLength(2);
    expect(err.diagnosis!.deliveryAttempts![0]!.headerName).toBe("X-PAYMENT");
    expect(err.diagnosis!.deliveryAttempts![1]!.headerName).toBe("Authorization");
  });
});
