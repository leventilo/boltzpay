import type { ProtocolQuote, ProtocolResult } from "@boltzpay/core";
import { Money, ProtocolDetectionFailedError } from "@boltzpay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @coinbase/cdp-sdk to prevent real imports
vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {
    constructor() {}
  },
}));

// Mock @boltzpay/protocols to provide controllable adapter behavior
const mockProbeAll = vi.fn();
const mockExecute = vi.fn();
const mockProbe = vi.fn();

vi.mock("@boltzpay/protocols", () => {
  class MockCdpWalletManager {
    constructor() {}
    getAddresses() {
      return {};
    }
    async getBalances() {
      return {};
    }
  }
  class MockProtocolRouter {
    probeAll = mockProbeAll;
    probe = mockProbe;
    execute = mockExecute;
    probeFromResponse = vi.fn().mockResolvedValue([]);
    constructor() {}
  }
  class MockX402Adapter {
    name = "x402";
    constructor() {}
  }
  class MockAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "AdapterError";
    }
  }
  class MockL402Adapter {
    name = "l402";
    constructor() {}
  }
  class MockNwcWalletManager {
    constructor() {}
    close() {}
  }
  class MockX402PaymentError extends MockAdapterError {
    constructor(message: string) {
      super("x402_payment_failed", message);
    }
  }
  class MockAggregatePaymentError extends MockAdapterError {
    errors: readonly Error[];
    constructor(errors: readonly Error[]) {
      const messages = errors
        .map((e, i) => `  ${i + 1}. ${e.message}`)
        .join("\n");
      super(
        "aggregate_payment_failed",
        `All payment attempts failed:\n${messages}`,
      );
      this.errors = errors;
    }
  }
  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: MockX402Adapter,
    MppAdapter: class MockMppAdapter { name = "mpp"; constructor() {} },
    MppMethodSelector: class MockMppMethodSelector { constructor() {} },
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
    X402PaymentError: MockX402PaymentError,
    AggregatePaymentError: MockAggregatePaymentError,
    negotiatePayment: vi.fn(),
  };
});

// Import AFTER mocks
import { BoltzPay } from "../../src/boltzpay";
import type { DryRunResult } from "../../src/diagnostics/dry-run";

const validConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

function makeQuote(overrides?: Partial<ProtocolQuote>): ProtocolQuote {
  return {
    amount: Money.fromDollars("0.01"),
    protocol: "x402",
    network: "eip155:8453",
    payTo: "0x1234567890abcdef1234567890abcdef12345678",
    scheme: "exact",
    allAccepts: [],
    ...overrides,
  };
}

function makeProbeResult(quoteOverrides?: Partial<ProtocolQuote>) {
  return {
    adapter: { name: "x402" },
    quote: makeQuote(quoteOverrides),
  };
}

describe("dryRun — payment pipeline simulation", () => {
  let agent: BoltzPay;

  beforeEach(() => {
    agent = new BoltzPay(validConfig);
    mockProbeAll.mockReset();
    mockProbe.mockReset();
    mockExecute.mockReset();
  });

  it("fetch(url, { dryRun: true }) returns DryRunResult", async () => {
    mockProbeAll.mockResolvedValue([makeProbeResult()]);

    const result = await agent.fetch(
      "https://api.example.com/data",
      { dryRun: true },
    );

    // Should be a DryRunResult, not a BoltzPayResponse
    expect(result).toHaveProperty("wouldPay");
    expect((result as DryRunResult).wouldPay).toBe(true);
  });

  it("free endpoint -> { wouldPay: false, reason: 'not_paid' }", async () => {
    mockProbeAll.mockRejectedValue(
      new ProtocolDetectionFailedError("https://free.example.com"),
    );

    const result = await agent.fetch(
      "https://free.example.com",
      { dryRun: true },
    ) as DryRunResult;

    expect(result.wouldPay).toBe(false);
    expect(result.reason).toBe("not_paid");
  });

  it("blocked domain -> { wouldPay: false, reason: 'domain_blocked' }", async () => {
    const blockedAgent = new BoltzPay({
      ...validConfig,
      blocklist: ["blocked.example.com"],
    });

    const result = await blockedAgent.fetch(
      "https://blocked.example.com/data",
      { dryRun: true },
    ) as DryRunResult;

    expect(result.wouldPay).toBe(false);
    expect(result.reason).toBe("domain_blocked");
  });

  it("upto scheme -> { wouldPay: false, reason: 'unsupported_scheme' }", async () => {
    mockProbeAll.mockResolvedValue([
      makeProbeResult({ scheme: "upto" }),
    ]);

    const result = await agent.fetch(
      "https://api.example.com/data",
      { dryRun: true },
    ) as DryRunResult;

    expect(result.wouldPay).toBe(false);
    expect(result.reason).toBe("unsupported_scheme");
  });

  it("no wallet for network -> { wouldPay: false, reason: 'no_wallet_for_network' }", async () => {
    // Agent with no wallets
    const noWalletAgent = new BoltzPay({ wallets: [] });
    mockProbeAll.mockResolvedValue([makeProbeResult()]);

    const result = await noWalletAgent.fetch(
      "https://api.example.com/data",
      { dryRun: true },
    ) as DryRunResult;

    expect(result.wouldPay).toBe(false);
    expect(result.reason).toBe("no_wallet_for_network");
  });

  it("budget exceeded -> { wouldPay: false, reason: 'budget_exceeded' }", async () => {
    const budgetAgent = new BoltzPay({
      ...validConfig,
      budget: { perTransaction: "0.01" },
    });
    // Quote = $0.05, per-transaction limit = $0.01 -> exceeded
    mockProbeAll.mockResolvedValue([
      makeProbeResult({ amount: Money.fromDollars("0.05") }),
    ]);

    const result = await budgetAgent.fetch(
      "https://api.example.com/data",
      { dryRun: true },
    ) as DryRunResult;

    expect(result.wouldPay).toBe(false);
    expect(result.reason).toBe("budget_exceeded");
    expect(result.budgetCheck).toBeDefined();
    expect(result.budgetCheck!.wouldExceed).toBe("per_transaction");
  });

  it("all checks pass -> wouldPay: true with quote, budget, wallet", async () => {
    mockProbeAll.mockResolvedValue([makeProbeResult()]);

    const result = await agent.fetch(
      "https://api.example.com/data",
      { dryRun: true },
    ) as DryRunResult;

    expect(result.wouldPay).toBe(true);
    expect(result.quote).toBeDefined();
    expect(result.quote!.protocol).toBe("x402");
    expect(result.quote!.scheme).toBe("exact");
    expect(result.budgetCheck).toBeDefined();
    expect(result.budgetCheck!.allowed).toBe(true);
    expect(result.wallet).toBeDefined();
    expect(result.wallet!.type).toBe("coinbase");
  });

  it("dryRun does NOT modify budget counters", async () => {
    const budgetAgent = new BoltzPay({
      ...validConfig,
      budget: { daily: "10.00" },
    });
    mockProbeAll.mockResolvedValue([makeProbeResult()]);

    const budgetBefore = budgetAgent.getBudget();
    await budgetAgent.fetch(
      "https://api.example.com/data",
      { dryRun: true },
    );
    const budgetAfter = budgetAgent.getBudget();

    expect(budgetAfter.dailySpent.cents).toBe(budgetBefore.dailySpent.cents);
  });

  it("dryRun does NOT call execute on adapter", async () => {
    mockProbeAll.mockResolvedValue([makeProbeResult()]);

    await agent.fetch(
      "https://api.example.com/data",
      { dryRun: true },
    );

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("network error -> { wouldPay: false, reason: 'network_error' }", async () => {
    mockProbeAll.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await agent.fetch(
      "https://api.example.com/data",
      { dryRun: true },
    ) as DryRunResult;

    expect(result.wouldPay).toBe(false);
    expect(result.reason).toBe("network_error");
  });

  it("stellar network -> { wouldPay: false, reason: 'unsupported_network' }", async () => {
    mockProbeAll.mockResolvedValue([
      makeProbeResult({ network: "stellar:pubnet", scheme: "exact" }),
    ]);

    const result = await agent.fetch(
      "https://api.example.com/data",
      { dryRun: true },
    ) as DryRunResult;

    expect(result.wouldPay).toBe(false);
    expect(result.reason).toBe("unsupported_network");
  });
});
