import {
  BudgetExceededError,
  ConfigurationError,
  InsufficientFundsError,
  NetworkError,
  ProtocolError,
} from "@boltzpay/sdk";
import chalk from "chalk";

import { type CliJsonDiagnosis, formatJsonError } from "./json.js";

export interface ErrorHandlerOptions {
  readonly jsonMode: boolean;
}

const EXIT_CODES = {
  general: 1,
  credentials: 2,
  budget: 3,
  payment: 4,
  network: 5,
  insufficientFunds: 6,
} as const;

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function getExitCode(error: unknown): number {
  if (error instanceof ConfigurationError) return EXIT_CODES.credentials;
  if (error instanceof BudgetExceededError) return EXIT_CODES.budget;
  if (error instanceof InsufficientFundsError)
    return EXIT_CODES.insufficientFunds;
  if (error instanceof ProtocolError) return EXIT_CODES.payment;
  if (error instanceof NetworkError) return EXIT_CODES.network;
  if (isTimeoutError(error)) return EXIT_CODES.network;
  return EXIT_CODES.general;
}

function getErrorCode(error: unknown): string {
  if (
    error instanceof ConfigurationError ||
    error instanceof BudgetExceededError ||
    error instanceof InsufficientFundsError ||
    error instanceof ProtocolError ||
    error instanceof NetworkError
  ) {
    return error.code;
  }
  if (isTimeoutError(error)) return "network_timeout";
  return "unknown_error";
}

function getErrorMessage(error: unknown): string {
  if (isTimeoutError(error)) {
    return "Request timed out. The server took too long to respond.";
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function getDiagnosis(error: unknown): CliJsonDiagnosis | undefined {
  if (error instanceof ProtocolError && error.diagnosis) {
    const d = error.diagnosis;
    return {
      phase: d.phase,
      paymentSent: d.paymentSent,
      serverStatus: d.serverStatus,
      serverMessage: d.serverMessage,
      suggestion: d.suggestion,
      deliveryAttempts: d.deliveryAttempts,
    };
  }
  return undefined;
}

function getSuggestion(error: unknown): string | undefined {
  if (error instanceof ConfigurationError) {
    return "Check your .env file or environment variables. Run `boltzpay wallet` to verify configuration.";
  }
  if (error instanceof BudgetExceededError) {
    return "Run `boltzpay budget` to check your spending limits.";
  }
  if (error instanceof InsufficientFundsError) {
    return "Your wallet does not have enough funds. Top up your USDC balance and try again.";
  }
  if (error instanceof ProtocolError) {
    if (error.code === "protocol_detection_failed") {
      return "This endpoint may be free. Try `boltzpay check <url>` to verify.";
    }
    if (error.code === "l402_payment_failed") {
      return "Lightning payment failed. Check your NWC wallet connection and balance.";
    }
    if (error.code === "l402_credentials_missing") {
      return "Add NWC_CONNECTION_STRING to your .env to enable Lightning payments.";
    }
    return "Run `boltzpay quote <url>` to inspect the endpoint before paying.";
  }
  if (error instanceof NetworkError) {
    return "Check your internet connection and try again.";
  }
  if (isTimeoutError(error)) {
    return "The endpoint may be down or slow. Try again later.";
  }
  return undefined;
}

function formatHumanError(error: unknown): string {
  const lines: string[] = [];
  const message = getErrorMessage(error);

  lines.push(`${chalk.red.bold("Error: ")}${message}`);

  const diagnosis = getDiagnosis(error);
  if (diagnosis) {
    lines.push("");
    lines.push(
      `${chalk.yellow("Diagnosis: ")}${diagnosis.phase} phase, payment ${diagnosis.paymentSent ? "sent" : "not sent"}${diagnosis.serverStatus ? `, HTTP ${diagnosis.serverStatus}` : ""}`,
    );
    if (diagnosis.serverMessage) {
      lines.push(`${chalk.dim("Server: ")}${diagnosis.serverMessage}`);
    }
    if (diagnosis.suggestion) {
      lines.push(`${chalk.dim("Suggestion: ")}${diagnosis.suggestion}`);
    }
  }

  const suggestion = getSuggestion(error);
  if (suggestion) {
    lines.push("");
    lines.push(`${chalk.dim("Hint: ")}${suggestion}`);
  }

  return lines.join("\n");
}

export function handleCliError(
  error: unknown,
  options: ErrorHandlerOptions,
): never {
  const exitCode = getExitCode(error);
  const code = getErrorCode(error);
  const message = getErrorMessage(error);

  if (options.jsonMode) {
    const diagnosis = getDiagnosis(error);
    process.stdout.write(`${formatJsonError(code, message, diagnosis)}\n`);
  } else {
    process.stderr.write(`${formatHumanError(error)}\n`);
  }

  process.exit(exitCode);
}
