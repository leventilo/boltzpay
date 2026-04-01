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
const mockProbeFromResponse = vi.fn();

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
    probeFromResponse = mockProbeFromResponse;
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
  };
});

// Import AFTER mocks
import { BoltzPay } from "../../src/boltzpay";
import { UnsupportedSchemeError } from "../../src/errors/unsupported-scheme-error";
import type { UnsupportedSchemeEvent } from "../../src/events/types";

const validConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

describe("guardScheme — upto detection guard", () => {
  let agent: BoltzPay;

  beforeEach(() => {
    agent = new BoltzPay(validConfig);
    mockProbeAll.mockReset();
    mockExecute.mockReset();
    mockProbeFromResponse.mockReset();
    mockProbeFromResponse.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws UnsupportedSchemeError when quote.scheme is 'upto'", async () => {
    const uptoQuote: ProtocolQuote = {
      amount: Money.fromCents(500n),
      protocol: "x402",
      network: "eip155:8453",
      payTo: "0xabc",
      scheme: "upto",
    };
    const mockAdapter = { name: "x402" };

    mockProbeAll.mockResolvedValueOnce([
      { adapter: mockAdapter, quote: uptoQuote },
    ]);

    await expect(agent.fetch("https://upto.com/api")).rejects.toThrow(
      UnsupportedSchemeError,
    );
  });

  it("includes scheme, maxAmount, and network in UnsupportedSchemeError", async () => {
    const uptoQuote: ProtocolQuote = {
      amount: Money.fromCents(1000n),
      protocol: "x402",
      network: "eip155:8453",
      payTo: "0xabc",
      scheme: "upto",
    };
    const mockAdapter = { name: "x402" };

    mockProbeAll.mockResolvedValueOnce([
      { adapter: mockAdapter, quote: uptoQuote },
    ]);

    try {
      await agent.fetch("https://upto.com/api");
      expect.fail("Should have thrown UnsupportedSchemeError");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedSchemeError);
      const error = err as UnsupportedSchemeError;
      expect(error.scheme).toBe("upto");
      expect(error.maxAmount?.cents).toBe(1000n);
      expect(error.network).toBe("eip155:8453");
    }
  });

  it('emits "protocol:unsupported-scheme" event before throwing', async () => {
    const uptoQuote: ProtocolQuote = {
      amount: Money.fromCents(500n),
      protocol: "x402",
      network: "eip155:8453",
      payTo: "0xabc",
      scheme: "upto",
    };
    const mockAdapter = { name: "x402" };

    mockProbeAll.mockResolvedValueOnce([
      { adapter: mockAdapter, quote: uptoQuote },
    ]);

    const schemeListener = vi.fn();
    agent.on("protocol:unsupported-scheme", schemeListener);

    try {
      await agent.fetch("https://upto.com/api");
    } catch {
      // expected
    }

    expect(schemeListener).toHaveBeenCalledTimes(1);
    const event: UnsupportedSchemeEvent = schemeListener.mock.calls[0][0];
    expect(event.scheme).toBe("upto");
    expect(event.url).toBe("https://upto.com/api");
    expect(event.maxAmount?.cents).toBe(500n);
    expect(event.network).toBe("eip155:8453");
  });

  it("allows exact scheme quotes to pass through without throwing", async () => {
    const exactQuote: ProtocolQuote = {
      amount: Money.fromCents(100n),
      protocol: "x402",
      network: "eip155:8453",
      payTo: "0xabc",
      scheme: "exact",
    };
    const mockAdapter = { name: "x402" };

    mockProbeAll.mockResolvedValueOnce([
      { adapter: mockAdapter, quote: exactQuote },
    ]);
    mockExecute.mockResolvedValueOnce({
      success: true,
      externalTxHash: "0xtx",
      responseBody: new TextEncoder().encode('{"data":"ok"}'),
      responseHeaders: { "content-type": "application/json" },
      responseStatus: 200,
    } satisfies ProtocolResult);

    const response = await agent.fetch("https://exact.com/api");
    expect(response.ok).toBe(true);
  });

  it("guardScheme is called AFTER selectPaymentChain, BEFORE payment execution", async () => {
    // A multi-accept quote with an "upto" scheme on the best accept
    const uptoQuote: ProtocolQuote = {
      amount: Money.fromCents(500n),
      protocol: "x402",
      network: "eip155:8453",
      payTo: "0xabc",
      scheme: "upto",
      allAccepts: [
        {
          scheme: "upto",
          network: "eip155:8453",
          amount: 500n,
          asset: "0xusdc",
          payTo: "0xabc",
          namespace: "evm",
        },
      ],
    };
    const mockAdapter = { name: "x402" };

    mockProbeAll.mockResolvedValueOnce([
      { adapter: mockAdapter, quote: uptoQuote },
    ]);

    // Execute should NOT be called (guard should block before payment)
    await expect(agent.fetch("https://upto.com/api")).rejects.toThrow(
      UnsupportedSchemeError,
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("propagates scheme through selectFromMultipleAccepts", async () => {
    // Multi-accept with scheme "exact" on the best accept — should pass
    const multiAcceptQuote: ProtocolQuote = {
      amount: Money.fromCents(100n),
      protocol: "x402",
      network: "eip155:8453",
      payTo: "0xabc",
      scheme: "exact",
      allAccepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: 100n,
          asset: "0xusdc",
          payTo: "0xabc",
          namespace: "evm",
        },
      ],
    };
    const mockAdapter = { name: "x402" };

    mockProbeAll.mockResolvedValueOnce([
      { adapter: mockAdapter, quote: multiAcceptQuote },
    ]);
    mockExecute.mockResolvedValueOnce({
      success: true,
      externalTxHash: "0xtx",
      responseBody: new TextEncoder().encode('{"data":"ok"}'),
      responseHeaders: { "content-type": "application/json" },
      responseStatus: 200,
    } satisfies ProtocolResult);

    const response = await agent.fetch("https://multi.com/api");
    expect(response.ok).toBe(true);
  });
});
