import {
  BudgetExceededError,
  ConfigurationError,
  InsufficientFundsError,
  Money,
  NetworkError,
  ProtocolError,
} from "@boltzpay/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleCliError } from "../../src/output/errors.js";

function noop(): void {}

describe("handleCliError", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(noop as () => never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("exit code mapping", () => {
    it("should map ConfigurationError to exit code 2", () => {
      const error = new ConfigurationError(
        "missing_coinbase_credentials",
        "Missing keys",
      );

      handleCliError(error, { jsonMode: false });

      expect(exitSpy).toHaveBeenCalledWith(2);
    });

    it("should map BudgetExceededError to exit code 3", () => {
      const error = new BudgetExceededError(
        "daily_budget_exceeded",
        Money.fromDollars("5.00"),
        Money.fromDollars("1.00"),
      );

      handleCliError(error, { jsonMode: false });

      expect(exitSpy).toHaveBeenCalledWith(3);
    });

    it("should map InsufficientFundsError to exit code 6", () => {
      const error = new InsufficientFundsError(
        "insufficient_usdc",
        "Not enough USDC",
      );

      handleCliError(error, { jsonMode: false });

      expect(exitSpy).toHaveBeenCalledWith(6);
    });

    it("should map ProtocolError to exit code 4", () => {
      const error = new ProtocolError("payment_failed", "Payment failed");

      handleCliError(error, { jsonMode: false });

      expect(exitSpy).toHaveBeenCalledWith(4);
    });

    it("should map NetworkError to exit code 5", () => {
      const error = new NetworkError("network_timeout", "Timed out");

      handleCliError(error, { jsonMode: false });

      expect(exitSpy).toHaveBeenCalledWith(5);
    });

    it("should map generic Error to exit code 1", () => {
      const error = new Error("Something unexpected");

      handleCliError(error, { jsonMode: false });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("JSON error output", () => {
    it("should write valid JSON to stdout", () => {
      const error = new ConfigurationError(
        "missing_coinbase_credentials",
        "Missing keys",
      );

      handleCliError(error, { jsonMode: true });

      expect(stdoutSpy).toHaveBeenCalled();
      const rawOutput = stdoutSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      const parsed = JSON.parse(output.trim());
      expect(parsed).toEqual({
        success: false,
        error: {
          code: "missing_coinbase_credentials",
          message: "Missing keys",
        },
      });
    });

    it("should include error code and message in JSON envelope", () => {
      const error = new ProtocolError(
        "payment_failed",
        "Payment to server failed",
      );

      handleCliError(error, { jsonMode: true });

      const rawOutput = stdoutSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      const parsed = JSON.parse(output.trim());
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("payment_failed");
      expect(parsed.error.message).toBe("Payment to server failed");
    });

    it("should handle generic Error with unknown_error code", () => {
      const error = new Error("Unexpected crash");

      handleCliError(error, { jsonMode: true });

      const rawOutput = stdoutSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      const parsed = JSON.parse(output.trim());
      expect(parsed.error.code).toBe("unknown_error");
      expect(parsed.error.message).toBe("Unexpected crash");
    });

    it("should include diagnosis in JSON when ProtocolError has one", () => {
      const error = new ProtocolError(
        "payment_failed",
        "Payment rejected",
        {
          phase: "delivery",
          paymentSent: true,
          serverStatus: 401,
          serverMessage: "API key required",
          suggestion: "Server requires additional authentication.",
        },
      );

      handleCliError(error, { jsonMode: true });

      const rawOutput = stdoutSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      const parsed = JSON.parse(output.trim());
      expect(parsed.error.diagnosis).toBeDefined();
      expect(parsed.error.diagnosis.phase).toBe("delivery");
      expect(parsed.error.diagnosis.paymentSent).toBe(true);
      expect(parsed.error.diagnosis.serverStatus).toBe(401);
      expect(parsed.error.diagnosis.serverMessage).toBe("API key required");
      expect(parsed.error.diagnosis.suggestion).toContain("authentication");
    });

    it("should omit diagnosis in JSON when ProtocolError has none", () => {
      const error = new ProtocolError(
        "payment_failed",
        "Payment failed",
      );

      handleCliError(error, { jsonMode: true });

      const rawOutput = stdoutSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      const parsed = JSON.parse(output.trim());
      expect(parsed.error.diagnosis).toBeUndefined();
    });
  });

  describe("human error output", () => {
    it("should write to stderr in human mode", () => {
      const error = new Error("Something went wrong");

      handleCliError(error, { jsonMode: false });

      expect(stderrSpy).toHaveBeenCalled();
      const rawOutput = stderrSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      expect(output).toContain("Something went wrong");
    });

    it("should not write to stdout in human mode", () => {
      const error = new Error("test");

      handleCliError(error, { jsonMode: false });

      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it("should include suggestion for ConfigurationError", () => {
      const error = new ConfigurationError(
        "missing_coinbase_credentials",
        "Missing keys",
      );

      handleCliError(error, { jsonMode: false });

      const rawOutput = stderrSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      expect(output).toContain("Hint");
      expect(output).toContain(".env");
    });

    it("should include budget suggestion for BudgetExceededError", () => {
      const error = new BudgetExceededError(
        "daily_budget_exceeded",
        Money.fromDollars("5.00"),
        Money.fromDollars("1.00"),
      );

      handleCliError(error, { jsonMode: false });

      const rawOutput = stderrSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      expect(output).toContain("budget");
    });

    it("should include funds suggestion for InsufficientFundsError", () => {
      const error = new InsufficientFundsError(
        "insufficient_usdc",
        "Not enough USDC",
      );

      handleCliError(error, { jsonMode: false });

      const rawOutput = stderrSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      expect(output).toContain("wallet");
      expect(output).toContain("funds");
    });

    it("should include network suggestion for NetworkError", () => {
      const error = new NetworkError(
        "endpoint_unreachable",
        "Could not reach server",
      );

      handleCliError(error, { jsonMode: false });

      const rawOutput = stderrSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      expect(output).toContain("internet connection");
    });

    it("should include Lightning-specific suggestion for l402_payment_failed", () => {
      const error = new ProtocolError(
        "l402_payment_failed",
        "NWC payment failed: routing error",
      );

      handleCliError(error, { jsonMode: false });

      const rawOutput = stderrSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      expect(output).toContain("NWC wallet");
    });

    it("should include NWC setup suggestion for l402_credentials_missing", () => {
      const error = new ProtocolError(
        "l402_credentials_missing",
        "NWC wallet not configured",
      );

      handleCliError(error, { jsonMode: false });

      const rawOutput = stderrSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      expect(output).toContain("NWC_CONNECTION_STRING");
    });

    it("should include diagnosis details in human output", () => {
      const error = new ProtocolError(
        "payment_failed",
        "Payment rejected (HTTP 400)",
        {
          phase: "delivery",
          paymentSent: true,
          serverStatus: 400,
          serverMessage: "Unknown model, available: [gpt-4, gpt-3.5]",
          suggestion: "Server rejected the request. Unknown model, available: [gpt-4, gpt-3.5]",
        },
      );

      handleCliError(error, { jsonMode: false });

      const rawOutput = stderrSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      expect(output).toContain("Diagnosis:");
      expect(output).toContain("delivery phase");
      expect(output).toContain("payment sent");
      expect(output).toContain("HTTP 400");
      expect(output).toContain("Unknown model");
      expect(output).toContain("Suggestion:");
    });
  });

  describe("timeout error handling", () => {
    it("should map TimeoutError to exit code 5 (network)", () => {
      const error = new DOMException("Timeout", "TimeoutError");

      handleCliError(error, { jsonMode: false });

      expect(exitSpy).toHaveBeenCalledWith(5);
    });

    it("should provide clear timeout message and suggestion", () => {
      const error = new DOMException("Timeout", "TimeoutError");

      handleCliError(error, { jsonMode: false });

      const rawOutput = stderrSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      expect(output).toContain("timed out");
      expect(output).toContain("Hint");
    });

    it("should return network_timeout code in JSON mode for TimeoutError", () => {
      const error = new DOMException("Timeout", "TimeoutError");

      handleCliError(error, { jsonMode: true });

      const rawOutput = stdoutSpy.mock.calls[0]?.[0];
      const output = typeof rawOutput === "string" ? rawOutput : "";
      const parsed = JSON.parse(output.trim());
      expect(parsed.error.code).toBe("network_timeout");
    });
  });
});
