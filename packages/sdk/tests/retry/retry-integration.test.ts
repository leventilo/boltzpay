import { Money } from "@boltzpay/core";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock @coinbase/cdp-sdk
vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {
    constructor() {}
  },
}));

// Track probeAll and execute calls for assertions
let probeAllFn: (...args: unknown[]) => Promise<unknown>;
let executeFn: (...args: unknown[]) => Promise<unknown>;
let probeFn: (...args: unknown[]) => Promise<unknown>;

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
    constructor() {}
    probeAll(...args: unknown[]) {
      return probeAllFn(...args);
    }
    probe(...args: unknown[]) {
      return probeFn(...args);
    }
    execute(...args: unknown[]) {
      return executeFn(...args);
    }
    probeFromResponse() {
      return Promise.resolve([]);
    }
  }
  class MockX402Adapter {
    name = "x402";
    constructor() {}
  }
  class MockL402Adapter {
    name = "l402";
    constructor() {}
  }
  class MockNwcWalletManager {
    constructor() {}
  }
  class MockAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  class MockX402PaymentError extends MockAdapterError {
    deliveryAttempts?: readonly {
      method: string;
      headerName: string;
      status: number;
    }[];
    suggestion?: string;
    constructor(
      message: string,
      opts?: {
        deliveryAttempts?: readonly {
          method: string;
          headerName: string;
          status: number;
        }[];
        suggestion?: string;
      },
    ) {
      super("x402_payment_failed", message);
      this.deliveryAttempts = opts?.deliveryAttempts;
      this.suggestion = opts?.suggestion;
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
import { NetworkError } from "../../src/errors/network-error";
import { PaymentUncertainError } from "../../src/errors/payment-uncertain-error";
import { RateLimitError } from "../../src/errors/rate-limit-error";

const TEST_URL = "https://api.example.com/data";

function makeProbeResult(overrides?: { adapterName?: string }) {
  return {
    adapter: { name: overrides?.adapterName ?? "x402" },
    quote: {
      amount: Money.fromDollars("0.10"),
      network: "eip155:8453",
      payTo: "0xabc",
      scheme: "exact",
    },
  };
}

function makeProtocolResult(overrides?: { status?: number; success?: boolean }) {
  return {
    success: overrides?.success ?? true,
    responseStatus: overrides?.status ?? 200,
    responseHeaders: { "content-type": "application/json" },
    responseBody: new TextEncoder().encode('{"data":"ok"}'),
    externalTxHash: "0xtxhash123",
  };
}

function createSDK(configOverrides?: Record<string, unknown>) {
  return new BoltzPay({
    coinbaseApiKeyId: "test-key-id",
    coinbaseApiKeySecret: "test-key-secret",
    coinbaseWalletSecret: "test-wallet-secret",
    logLevel: "silent",
    retry: { maxRetries: 3, backoffMs: 1 },
    rateLimit: { strategy: "wait", maxWaitMs: 100 },
    ...configOverrides,
  });
}

describe("Retry Integration — BoltzPay.fetch() wiring", () => {
  beforeEach(() => {
    // Reset to default behaviors (fail with error)
    probeAllFn = () =>
      Promise.reject(new Error("probeAll not configured for this test"));
    executeFn = () =>
      Promise.reject(new Error("execute not configured for this test"));
    probeFn = () =>
      Promise.reject(new Error("probe not configured for this test"));
  });

  describe("RES-01: Retry on detect (probeOrPassthrough)", () => {
    it("retries probeAll on NetworkError and succeeds", async () => {
      let calls = 0;
      probeAllFn = () => {
        calls++;
        if (calls === 1) {
          return Promise.reject(
            new NetworkError("endpoint_unreachable", "ECONNRESET"),
          );
        }
        return Promise.resolve([makeProbeResult()]);
      };
      executeFn = () => Promise.resolve(makeProtocolResult());

      const sdk = createSDK();
      const response = await sdk.fetch(TEST_URL);

      expect(response.ok).toBe(true);
      expect(calls).toBe(2);
    });

    it("exhausts retries on persistent NetworkError", async () => {
      let calls = 0;
      probeAllFn = () => {
        calls++;
        return Promise.reject(
          new NetworkError("endpoint_unreachable", "ECONNRESET"),
        );
      };

      const sdk = createSDK({ retry: { maxRetries: 2, backoffMs: 1 } });
      await expect(sdk.fetch(TEST_URL)).rejects.toThrow(NetworkError);
      // 1 initial + 2 retries = 3 total
      expect(calls).toBe(3);
    });
  });

  describe("RES-02: Payment-safe boundary (PaymentUncertainError)", () => {
    it("throws PaymentUncertainError on post-signature network error", async () => {
      probeAllFn = () => Promise.resolve([makeProbeResult()]);
      executeFn = () => {
        const err = new Error("fetch failed: ECONNRESET");
        return Promise.reject(err);
      };

      const sdk = createSDK();
      try {
        await sdk.fetch(TEST_URL);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PaymentUncertainError);
        const uncertain = err as PaymentUncertainError;
        expect(uncertain.url).toBe(TEST_URL);
        expect(uncertain.protocol).toBe("x402");
        expect(uncertain.amount.toDisplayString()).toBe("$0.10");
      }
    });

    it("emits payment:uncertain event before throwing", async () => {
      probeAllFn = () => Promise.resolve([makeProbeResult()]);
      executeFn = () =>
        Promise.reject(new Error("fetch failed: ECONNRESET"));

      const sdk = createSDK();
      const events: unknown[] = [];
      sdk.on("payment:uncertain", (evt) => events.push(evt));

      await expect(sdk.fetch(TEST_URL)).rejects.toThrow(
        PaymentUncertainError,
      );
      expect(events).toHaveLength(1);
      const evt = events[0] as Record<string, unknown>;
      expect(evt.url).toBe(TEST_URL);
      expect(evt.protocol).toBe("x402");
    });

    it("logs PaymentUncertainError with critical:true", async () => {
      probeAllFn = () => Promise.resolve([makeProbeResult()]);
      executeFn = () =>
        Promise.reject(new Error("fetch failed: ECONNRESET"));

      const sdk = createSDK({ logLevel: "error" });
      // Spy on the logger (access private, but valid in tests)
      const loggerSpy = vi.spyOn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sdk as any).logger,
        "error",
      );

      await expect(sdk.fetch(TEST_URL)).rejects.toThrow(
        PaymentUncertainError,
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("PAYMENT UNCERTAIN"),
        expect.objectContaining({ critical: true }),
      );
    });
  });

  describe("RES-03: Rate limit strategy from config", () => {
    it("applies rate limit strategy 'error' — throws immediately on RateLimitError", async () => {
      let calls = 0;
      probeAllFn = () => {
        calls++;
        return Promise.reject(new RateLimitError("Too many requests", 1000));
      };

      const sdk = createSDK({
        retry: { maxRetries: 3, backoffMs: 1 },
        rateLimit: { strategy: "error", maxWaitMs: 100 },
      });
      await expect(sdk.fetch(TEST_URL)).rejects.toThrow();
      // With strategy='error', should throw immediately — only 1 call
      expect(calls).toBe(1);
    });
  });

  describe("RES-04: Unified withRetry engine", () => {
    it("detect and quote use the same withRetry engine", async () => {
      // Test detect retry via fetch()
      let detectCalls = 0;
      probeAllFn = () => {
        detectCalls++;
        if (detectCalls === 1) {
          return Promise.reject(
            new NetworkError("endpoint_unreachable", "ECONNRESET"),
          );
        }
        return Promise.resolve([makeProbeResult()]);
      };
      executeFn = () => Promise.resolve(makeProtocolResult());

      const sdk = createSDK();
      const response = await sdk.fetch(TEST_URL);
      expect(response.ok).toBe(true);
      expect(detectCalls).toBe(2);

      // Test quote retry via quote()
      let quoteCalls = 0;
      probeFn = () => {
        quoteCalls++;
        if (quoteCalls === 1) {
          return Promise.reject(
            new NetworkError("endpoint_unreachable", "ECONNRESET"),
          );
        }
        return Promise.resolve(makeProbeResult());
      };

      const quoteResult = await sdk.quote(TEST_URL);
      expect(quoteResult.amount.toDisplayString()).toBe("$0.10");
      expect(quoteCalls).toBe(2);
    });
  });

  describe("Config wiring", () => {
    it("maxRetries:0 disables retry (fail-fast)", async () => {
      let calls = 0;
      probeAllFn = () => {
        calls++;
        return Promise.reject(
          new NetworkError("endpoint_unreachable", "ECONNRESET"),
        );
      };

      const sdk = createSDK({ retry: { maxRetries: 0, backoffMs: 1 } });
      await expect(sdk.fetch(TEST_URL)).rejects.toThrow(NetworkError);
      // maxRetries:0 means no retry — only 1 call
      expect(calls).toBe(1);
    });

    it("default config retries 3 times", async () => {
      let calls = 0;
      probeAllFn = () => {
        calls++;
        if (calls <= 3) {
          return Promise.reject(
            new NetworkError("endpoint_unreachable", "ECONNRESET"),
          );
        }
        return Promise.resolve([makeProbeResult()]);
      };
      executeFn = () => Promise.resolve(makeProtocolResult());

      const sdk = createSDK();
      const response = await sdk.fetch(TEST_URL);
      expect(response.ok).toBe(true);
      // 3 failures + 1 success = 4 calls
      expect(calls).toBe(4);
    });
  });
});
