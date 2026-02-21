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
const mockGetAdapterByName = vi.fn();

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
    execute = mockExecute;
    getAdapterByName = mockGetAdapterByName;
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
  }
  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: MockX402Adapter,
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
  };
});

// Import AFTER mocks
import { BoltzPay } from "../../src/boltzpay";
import { BudgetExceededError } from "../../src/errors/budget-exceeded-error";

const baseConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

function makeProbeResult(amountCents: bigint): {
  adapter: { name: string };
  quote: ProtocolQuote;
} {
  return {
    adapter: { name: "x402" },
    quote: {
      amount: Money.fromCents(amountCents),
      protocol: "x402",
      network: "eip155:84532",
      payTo: "0xabc",
    },
  };
}

function makeSuccessResult(): ProtocolResult {
  return {
    success: true,
    externalTxHash: "0xtx_max_amount",
    responseBody: new TextEncoder().encode("{}"),
    responseHeaders: { "content-type": "application/json" },
    responseStatus: 200,
  };
}

const fetchOriginal = globalThis.fetch;
const fetchMock = vi.fn();

describe("maxAmount guard", () => {
  let agent: BoltzPay;

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    // No budget limits configured -- maxAmount is per-call guard
    agent = new BoltzPay(baseConfig);
    mockProbeAll.mockReset();
    mockExecute.mockReset();
    mockGetAdapterByName.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    vi.clearAllMocks();
  });

  it("should block payment when quote exceeds maxAmount", async () => {
    // Quote returns $0.50 (50 cents), maxAmount is $0.10
    mockProbeAll.mockResolvedValueOnce([makeProbeResult(50n)]);

    await expect(
      agent.fetch("https://paid.com/api", { maxAmount: 0.1 }),
    ).rejects.toThrow(BudgetExceededError);
  });

  it("should throw BudgetExceededError with per_transaction_exceeded code", async () => {
    mockProbeAll.mockResolvedValueOnce([makeProbeResult(50n)]);

    try {
      await agent.fetch("https://paid.com/api", { maxAmount: 0.1 });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).code).toBe(
        "per_transaction_exceeded",
      );
    }
  });

  it("should allow payment when quote is below maxAmount", async () => {
    // Quote returns $0.50 (50 cents), maxAmount is $1.00
    mockProbeAll.mockResolvedValueOnce([makeProbeResult(50n)]);
    mockExecute.mockResolvedValueOnce(makeSuccessResult());

    const response = await agent.fetch("https://paid.com/api", {
      maxAmount: 1.0,
    });

    expect(response.ok).toBe(true);
    expect(response.payment).not.toBeNull();
  });

  it("should allow payment when quote equals maxAmount", async () => {
    // Quote returns $0.50 (50 cents), maxAmount is $0.50
    mockProbeAll.mockResolvedValueOnce([makeProbeResult(50n)]);
    mockExecute.mockResolvedValueOnce(makeSuccessResult());

    const response = await agent.fetch("https://paid.com/api", {
      maxAmount: 0.5,
    });

    expect(response.ok).toBe(true);
  });

  it("should pass through free endpoint regardless of maxAmount", async () => {
    mockProbeAll.mockRejectedValueOnce(
      new ProtocolDetectionFailedError("https://free.com/data"),
    );

    fetchMock.mockResolvedValueOnce(new Response("free", { status: 200 }));

    const response = await agent.fetch("https://free.com/data", {
      maxAmount: 0.01,
    });

    expect(response.ok).toBe(true);
    expect(response.payment).toBeUndefined();
  });

  it("should emit error event when maxAmount exceeded", async () => {
    mockProbeAll.mockResolvedValueOnce([makeProbeResult(50n)]);

    const errorListener = vi.fn();
    agent.on("error", errorListener);

    await expect(
      agent.fetch("https://paid.com/api", { maxAmount: 0.1 }),
    ).rejects.toThrow(BudgetExceededError);

    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(errorListener.mock.calls[0][0]).toBeInstanceOf(BudgetExceededError);
  });

  it("should work without any budget config (maxAmount is independent)", async () => {
    // Agent has no budget configured, only per-call maxAmount
    mockProbeAll.mockResolvedValueOnce([makeProbeResult(200n)]); // $2.00

    await expect(
      agent.fetch("https://paid.com/api", { maxAmount: 1.0 }),
    ).rejects.toThrow(BudgetExceededError);
  });
});
