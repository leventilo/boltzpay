import type { BudgetState, PaymentRecord, WalletStatus } from "@boltzpay/sdk";
import { BoltzPayResponse, Money } from "@boltzpay/sdk";
import { describe, expect, it } from "vitest";

import {
  formatBudgetResult,
  formatCheckResult,
  formatDiscoverResult,
  formatFetchResult,
  formatHistoryResult,
  formatQuoteResult,
  formatWalletStatus,
} from "../../src/output/formatter.js";

function makeResponse(
  options: {
    status?: number;
    headers?: Record<string, string>;
    payment?: {
      protocol: "x402" | "l402";
      amount: Money;
      url: string;
      timestamp: Date;
      txHash: string | undefined;
    } | null;
    body?: string;
  } = {},
): BoltzPayResponse {
  const status = options.status ?? 200;
  const body = options.body ?? '{"ok": true}';
  return new BoltzPayResponse({
    ok: status >= 200 && status < 400,
    status,
    headers: options.headers ?? { "content-type": "application/json" },
    rawBody: new TextEncoder().encode(body),
    payment: options.payment ?? null,
    protocol: options.payment?.protocol ?? null,
  });
}

describe("formatFetchResult", () => {
  it("should include Response section with URL and status", () => {
    const result = formatFetchResult({
      response: makeResponse({ status: 200 }),
      body: '{"data": "test"}',
      duration: 150,
      url: "https://api.example.com/data",
      detail: "normal",
    });

    expect(result).toContain("Response");
    expect(result).toContain("https://api.example.com/data");
    expect(result).toContain("200");
  });

  it("should include Payment section when payment present", () => {
    const result = formatFetchResult({
      response: makeResponse({
        payment: {
          protocol: "x402",
          amount: Money.fromDollars("0.05"),
          url: "https://api.example.com/paid",
          timestamp: new Date(),
          txHash: "0xabc123",
        },
      }),
      body: "response body",
      duration: 100,
      url: "https://api.example.com/paid",
      detail: "normal",
    });

    expect(result).toContain("Payment");
    expect(result).toContain("x402");
    expect(result).toContain("$0.05");
    expect(result).toContain("0xabc123");
  });

  it("should include Body content", () => {
    const result = formatFetchResult({
      response: makeResponse(),
      body: "hello world body content",
      duration: 50,
      url: "https://example.com",
      detail: "normal",
    });

    expect(result).toContain("Body");
    expect(result).toContain("hello world body content");
  });

  it("should add timing info in verbose mode", () => {
    const result = formatFetchResult({
      response: makeResponse(),
      body: "test",
      duration: 250,
      url: "https://example.com",
      detail: "verbose",
    });

    expect(result).toContain("Duration");
    expect(result).toContain("250ms");
    expect(result).toContain("Headers");
  });

  it("should truncate body longer than 5000 chars", () => {
    const longBody = "x".repeat(6000);
    const result = formatFetchResult({
      response: makeResponse(),
      body: longBody,
      duration: 50,
      url: "https://example.com",
      detail: "normal",
    });

    expect(result).toContain("truncated");
    expect(result).toContain("6000 chars total");
    expect(result).not.toContain("x".repeat(6000));
  });

  it("should show content-type header", () => {
    const result = formatFetchResult({
      response: makeResponse({
        headers: { "content-type": "text/plain" },
      }),
      body: "test",
      duration: 50,
      url: "https://example.com",
      detail: "normal",
    });

    expect(result).toContain("text/plain");
  });
});

describe("formatQuoteResult", () => {
  it("should show protocol, amount, and currency", () => {
    const result = formatQuoteResult({
      protocol: "x402",
      amount: "$0.05",
      network: "base",
    });

    expect(result).toContain("Quote");
    expect(result).toContain("x402");
    expect(result).toContain("$0.05");
  });

  it("should show network when provided", () => {
    const result = formatQuoteResult({
      protocol: "x402",
      amount: "$0.10",
      network: "base-sepolia",
    });

    expect(result).toContain("base-sepolia");
  });

  it("should omit network line when undefined", () => {
    const result = formatQuoteResult({
      protocol: "l402",
      amount: "$1.00",
      network: undefined,
    });

    expect(result).toContain("l402");
    expect(result).not.toContain("Network");
  });
});

describe("formatBudgetResult", () => {
  it("should show daily limit, spent, and remaining", () => {
    const budget: BudgetState = {
      dailySpent: Money.fromDollars("2.50"),
      monthlySpent: Money.fromDollars("10.00"),
      dailyLimit: Money.fromDollars("10.00"),
      monthlyLimit: undefined,
      perTransactionLimit: undefined,
      dailyRemaining: Money.fromDollars("7.50"),
      monthlyRemaining: undefined,
    };

    const result = formatBudgetResult(budget);

    expect(result).toContain("Budget Status");
    expect(result).toContain("Daily");
    expect(result).toContain("$2.50");
    expect(result).toContain("$10.00");
    expect(result).toContain("$7.50");
  });

  it("should show 'No budget limits configured' when no limits set", () => {
    const budget: BudgetState = {
      dailySpent: Money.zero(),
      monthlySpent: Money.zero(),
      dailyLimit: undefined,
      monthlyLimit: undefined,
      perTransactionLimit: undefined,
      dailyRemaining: undefined,
      monthlyRemaining: undefined,
    };

    const result = formatBudgetResult(budget);

    expect(result).toContain("No budget limits configured");
  });

  it("should show monthly and per-transaction limits", () => {
    const budget: BudgetState = {
      dailySpent: Money.zero(),
      monthlySpent: Money.fromDollars("50.00"),
      dailyLimit: undefined,
      monthlyLimit: Money.fromDollars("100.00"),
      perTransactionLimit: Money.fromDollars("5.00"),
      dailyRemaining: undefined,
      monthlyRemaining: Money.fromDollars("50.00"),
    };

    const result = formatBudgetResult(budget);

    expect(result).toContain("Monthly");
    expect(result).toContain("$100.00");
    expect(result).toContain("Per Transaction");
    expect(result).toContain("$5.00");
  });
});

describe("formatHistoryResult", () => {
  it("should list payments with URL, amount, protocol, and timestamp", () => {
    const records: PaymentRecord[] = [
      {
        id: "pay-1",
        url: "https://api.example.com/data",
        protocol: "x402",
        amount: Money.fromDollars("0.05"),
        timestamp: new Date("2026-02-18T10:00:00Z"),
        txHash: "0xabc",
        network: "base",
      },
      {
        id: "pay-2",
        url: "https://api.example.com/other",
        protocol: "l402",
        amount: Money.fromDollars("1.00"),
        timestamp: new Date("2026-02-18T11:00:00Z"),
        txHash: undefined,
        network: undefined,
      },
    ];

    const result = formatHistoryResult(records);

    expect(result).toContain("Payment History");
    expect(result).toContain("x402");
    expect(result).toContain("l402");
    expect(result).toContain("$0.05");
    expect(result).toContain("$1.00");
    expect(result).toContain("2 payment(s) total");
  });

  it("should show 'No payments made yet' when empty", () => {
    const result = formatHistoryResult([]);

    expect(result).toContain("No payments made yet");
  });
});

describe("formatDiscoverResult", () => {
  it("should list API entries with name, URL, pricing, and category", () => {
    const entries = [
      {
        name: "Test API",
        url: "https://api.test.com/v1",
        protocol: "x402",
        pricing: "$0.01-0.05/query",
        category: "search",
        description: "A test API endpoint",
        live: {
          status: "live" as const,
          livePrice: "$0.03",
          protocol: "x402",
          network: "eip155:8453",
        },
      },
    ];

    const result = formatDiscoverResult(entries);

    expect(result).toContain("Compatible Paid API Endpoints");
    expect(result).toContain("Test API");
    expect(result).toContain("https://api.test.com/v1");
    expect(result).toContain("$0.03");
    expect(result).toContain("search");
    expect(result).toContain("A test API endpoint");
    expect(result).toContain("LIVE");
    expect(result).toContain("1 endpoint(s)");
  });

  it("should show 'No matching endpoints found' when empty", () => {
    const result = formatDiscoverResult([]);

    expect(result).toContain("No matching endpoints found");
  });
});

describe("formatCheckResult", () => {
  it("should show 'Paid endpoint' for paid URLs", () => {
    const result = formatCheckResult({
      isPaid: true,
      protocol: "x402",
      amount: "$0.05",
    });

    expect(result).toContain("Paid endpoint");
    expect(result).toContain("x402");
    expect(result).toContain("$0.05");
  });

  it("should show 'Free endpoint' for free URLs", () => {
    const result = formatCheckResult({ isPaid: false });

    expect(result).toContain("Free endpoint");
    expect(result).toContain("no payment required");
  });
});

function makeWalletStatus(
  overrides: Partial<WalletStatus> = {},
): WalletStatus {
  return {
    network: "base",
    isTestnet: false,
    protocols: ["x402"],
    canPay: false,
    credentials: {
      coinbase: { configured: false, keyHint: undefined },
    },
    connection: {
      status: "skipped",
      reason: "Coinbase credentials not configured",
    },
    accounts: { evm: undefined, svm: undefined },
    budget: {
      dailySpent: Money.zero(),
      monthlySpent: Money.zero(),
      dailyLimit: undefined,
      monthlyLimit: undefined,
      perTransactionLimit: undefined,
      dailyRemaining: undefined,
      monthlyRemaining: undefined,
    },
    ...overrides,
  };
}

describe("formatWalletStatus", () => {
  it("should show network, protocols, and connection info", () => {
    const result = formatWalletStatus(
      makeWalletStatus({
        protocols: ["x402", "l402"],
      }),
    );

    expect(result).toContain("Wallet Status");
    expect(result).toContain("base");
    expect(result).toContain("x402, l402");
  });

  it("should show 'No limits configured' when no budget", () => {
    const result = formatWalletStatus(
      makeWalletStatus({
        network: "base-sepolia",
        isTestnet: true,
      }),
    );

    expect(result).toContain("No limits configured");
    expect(result).toContain("base-sepolia");
    expect(result).toContain("testnet");
  });
});
