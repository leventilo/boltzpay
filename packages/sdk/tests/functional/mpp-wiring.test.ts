import type { ProtocolQuote, ProtocolResult } from "@boltzpay/core";
import { Money } from "@boltzpay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {
    constructor() {}
  },
}));

const mockProbeAll = vi.fn();
const mockExecute = vi.fn();
const mockGetAddresses = vi.fn();
const mockGetBalances = vi.fn();

vi.mock("@boltzpay/protocols", () => {
  class MockCdpWalletManager {
    constructor() {}
    getAddresses = mockGetAddresses;
    getBalances = mockGetBalances;
  }
  class MockProtocolRouter {
    probeAll = mockProbeAll;
    execute = mockExecute;
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
  class MockMppAdapter {
    name = "mpp";
    constructor() {}
  }
  class MockMppMethodSelector {
    constructor() {}
  }
  class MockNwcWalletManager {
    constructor() {}
    close() {}
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
    L402Adapter: MockL402Adapter,
    MppAdapter: MockMppAdapter,
    MppMethodSelector: MockMppMethodSelector,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
    X402PaymentError: MockX402PaymentError,
    AggregatePaymentError: MockAggregatePaymentError,
  };
});

import { BoltzPay } from "../../src/boltzpay";
import { NoWalletError } from "../../src/errors/no-wallet-error";

function makeX402Quote(overrides?: Partial<ProtocolQuote>): ProtocolQuote {
  return {
    amount: Money.fromCents(100n),
    protocol: "x402",
    network: "eip155:8453",
    payTo: "0xabc",
    scheme: "exact",
    ...overrides,
  };
}

function makeMppQuote(overrides?: Partial<ProtocolQuote>): ProtocolQuote {
  return {
    amount: Money.fromCents(100n),
    protocol: "mpp",
    payTo: "https://mpp-provider.com/pay",
    scheme: "exact",
    selectedMethod: "tempo",
    ...overrides,
  };
}

function makeSuccessResult(): ProtocolResult {
  return {
    success: true,
    externalTxHash: "0xtx_mpp_wiring",
    responseBody: new TextEncoder().encode("{}"),
    responseHeaders: { "content-type": "application/json" },
    responseStatus: 200,
  };
}

const coinbaseConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

const tempoConfig = {
  wallets: [
    {
      type: "tempo" as const,
      name: "tempo-wallet",
      tempoPrivateKey: "test-pk",
    },
  ],
};

describe("MppAdapter wiring and wallet-aware fallback", () => {
  beforeEach(() => {
    mockProbeAll.mockReset();
    mockExecute.mockReset();
    mockGetAddresses.mockReset();
    mockGetBalances.mockReset();
    mockGetAddresses.mockReturnValue({});
    mockGetBalances.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("selectWalletForPayment for MPP", () => {
    it("selects tempo wallet when quote.protocol=mpp and selectedMethod=tempo", async () => {
      const mppQuote = makeMppQuote({ selectedMethod: "tempo" });
      const mockAdapter = { name: "mpp" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: mockAdapter, quote: mppQuote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const walletSelectedListener = vi.fn();
      const client = new BoltzPay(tempoConfig);
      client.on("wallet:selected", walletSelectedListener);

      await client.fetch("https://mpp-endpoint.com/api");

      expect(walletSelectedListener).toHaveBeenCalledTimes(1);
      const event = walletSelectedListener.mock.calls[0]![0];
      expect(event.walletName).toBe("tempo-wallet");
      expect(event.network).toBe("tempo");
    });

    it("throws NoWalletError when quote.protocol=mpp and no matching wallet configured", async () => {
      const mppQuote = makeMppQuote({ selectedMethod: "tempo" });
      const mockAdapter = { name: "mpp" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: mockAdapter, quote: mppQuote },
      ]);

      const client = new BoltzPay({ wallets: [] });

      await expect(
        client.fetch("https://mpp-endpoint.com/api"),
      ).rejects.toThrow(NoWalletError);
    });
  });

  describe("existing x402/L402 wallet selection (regression)", () => {
    it("coinbase wallet still works for x402 quote", async () => {
      const x402Quote = makeX402Quote({ network: "eip155:8453" });
      const mockAdapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: mockAdapter, quote: x402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(coinbaseConfig);
      const response = await client.fetch("https://paid.com/api");

      expect(response.ok).toBe(true);
    });

    it("nwc wallet still works for l402 quote", async () => {
      const l402Quote: ProtocolQuote = {
        amount: Money.fromCents(100n),
        protocol: "l402",
        payTo: "lnbc100...",
        scheme: "exact",
      };
      const mockAdapter = { name: "l402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: mockAdapter, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay({
        wallets: [
          {
            type: "nwc" as const,
            name: "nwc-wallet",
            nwcConnectionString: "nostr+walletconnect://test",
          },
        ],
      });

      const response = await client.fetch("https://l402.example.com/api");

      expect(response.ok).toBe(true);
    });
  });

  describe("dual-protocol fallback with wallet-aware sorting", () => {
    it("dual-protocol (MPP + x402): x402 wallet only -> MPP skipped silently, x402 succeeds", async () => {
      const mppQuote = makeMppQuote({ selectedMethod: "tempo" });
      const x402Quote = makeX402Quote({ network: "eip155:8453" });
      const mppAdapter = { name: "mpp" };
      const x402Adapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: mppAdapter, quote: mppQuote },
        { adapter: x402Adapter, quote: x402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(coinbaseConfig);
      const response = await client.fetch("https://dual-protocol.com/api");

      expect(response.ok).toBe(true);
    });

    it("dual-protocol (MPP + x402): tempo wallet only -> x402 skipped, MPP succeeds", async () => {
      const mppQuote = makeMppQuote({ selectedMethod: "tempo" });
      const x402Quote = makeX402Quote({ network: "eip155:8453" });
      const mppAdapter = { name: "mpp" };
      const x402Adapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: mppAdapter, quote: mppQuote },
        { adapter: x402Adapter, quote: x402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(tempoConfig);
      const response = await client.fetch("https://dual-protocol.com/api");

      expect(response.ok).toBe(true);
    });

    it("probeResults sorted: adapters with configured wallets come first", async () => {
      const mppQuote = makeMppQuote({ selectedMethod: "tempo" });
      const x402Quote = makeX402Quote({ network: "eip155:8453" });
      const mppAdapter = { name: "mpp" };
      const x402Adapter = { name: "x402" };

      let executedAdapterName: string | undefined;
      mockProbeAll.mockResolvedValueOnce([
        { adapter: mppAdapter, quote: mppQuote },
        { adapter: x402Adapter, quote: x402Quote },
      ]);
      mockExecute.mockImplementation(
        async (adapter: { name: string }) => {
          executedAdapterName = adapter.name;
          return makeSuccessResult();
        },
      );

      const client = new BoltzPay(coinbaseConfig);
      await client.fetch("https://dual-protocol.com/api");

      // x402 should be tried first because coinbase wallet is configured (not tempo)
      expect(executedAdapterName).toBe("x402");
    });

    it("all detected protocols have no matching wallet -> throws NoWalletError", async () => {
      const mppQuote = makeMppQuote({ selectedMethod: "tempo" });
      const x402Quote = makeX402Quote({ network: "eip155:8453" });
      const mppAdapter = { name: "mpp" };
      const x402Adapter = { name: "x402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: mppAdapter, quote: mppQuote },
        { adapter: x402Adapter, quote: x402Quote },
      ]);

      const client = new BoltzPay({ wallets: [] });

      await expect(
        client.fetch("https://dual-protocol.com/api"),
      ).rejects.toThrow(NoWalletError);
    });
  });
});
