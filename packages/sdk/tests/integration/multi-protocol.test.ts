import type { ProtocolQuote, ProtocolResult } from "@boltzpay/core";
import { Money, ProtocolDetectionFailedError } from "@boltzpay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @coinbase/cdp-sdk to prevent real imports
vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {
    constructor() {}
  },
}));

// Mock @boltzpay/protocols with controllable adapter behavior
const mockProbeAll = vi.fn();
const mockProbe = vi.fn();
const mockExecute = vi.fn();
const mockGetAdapterByName = vi.fn();
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
    probe = mockProbe;
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
    AggregatePaymentError: MockAdapterError,
  };
});

// Import AFTER mocks
import { BoltzPay } from "../../src/boltzpay";
import { BudgetExceededError } from "../../src/errors/budget-exceeded-error";
import { ProtocolError } from "../../src/errors/protocol-error";

const x402OnlyConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

const l402OnlyConfig = {
  nwcConnectionString:
    "nostr+walletconnect://relay.example.com/v1?secret=abc123&relay=wss://relay.example.com",
};

const dualConfig = {
  ...x402OnlyConfig,
  ...l402OnlyConfig,
};

function makeX402Quote(amountCents: bigint): ProtocolQuote {
  return {
    amount: Money.fromCents(amountCents),
    protocol: "x402",
    network: "eip155:8453",
    payTo: "0xPayAddr",
  };
}

function makeL402Quote(amountSats: bigint): ProtocolQuote {
  return {
    amount: Money.fromSatoshis(amountSats),
    protocol: "l402",
    network: "lightning",
    payTo: undefined,
  };
}

function makeSuccessResult(
  overrides?: Partial<ProtocolResult>,
): ProtocolResult {
  return {
    success: true,
    externalTxHash: "0xtx_hash",
    responseBody: new TextEncoder().encode('{"data":"ok"}'),
    responseHeaders: { "content-type": "application/json" },
    responseStatus: 200,
    ...overrides,
  };
}

describe("multi-protocol agnostic SDK (x402 + L402)", () => {
  beforeEach(() => {
    mockProbeAll.mockReset();
    mockProbe.mockReset();
    mockExecute.mockReset();
    mockGetAdapterByName.mockReset();
    mockGetAddresses.mockReset().mockReturnValue({});
    mockGetBalances.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Capabilities ───────────────────────────────────────────────

  describe("getCapabilities() protocol reporting", () => {
    it("reports both x402 and l402 when dual config", () => {
      const client = new BoltzPay(dualConfig);
      const caps = client.getCapabilities();

      expect(caps.protocols).toContain("x402");
      expect(caps.protocols).toContain("l402");
      expect(caps.canPay).toBe(true);
      expect(caps.canPayLightning).toBe(true);
    });

    it("reports x402 only when no NWC configured", () => {
      const client = new BoltzPay(x402OnlyConfig);
      const caps = client.getCapabilities();

      expect(caps.protocols).toEqual(["x402"]);
      expect(caps.canPay).toBe(true);
      expect(caps.canPayLightning).toBe(false);
    });

    it("reports l402 alongside x402 when NWC-only config", () => {
      const client = new BoltzPay(l402OnlyConfig);
      const caps = client.getCapabilities();

      // x402 is always listed (detection works without credentials)
      expect(caps.protocols).toContain("x402");
      expect(caps.protocols).toContain("l402");
      expect(caps.canPay).toBe(false); // No Coinbase credentials
      expect(caps.canPayLightning).toBe(true);
    });

    it("reports no payment capability without any credentials", () => {
      const client = new BoltzPay({});
      const caps = client.getCapabilities();

      expect(caps.canPay).toBe(false);
      expect(caps.canPayLightning).toBe(false);
    });
  });

  // ─── L402 fetch flow ────────────────────────────────────────────

  describe("L402 fetch flow through SDK", () => {
    it("should complete L402 payment and return BoltzPayResponse", async () => {
      const l402Quote = makeL402Quote(200n);
      const l402Adapter = { name: "l402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: l402Adapter, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch("https://l402-api.example.com/data");

      expect(response.ok).toBe(true);
      expect(response.protocol).toBe("l402");
      expect(response.payment).toBeDefined();
      expect(response.payment?.protocol).toBe("l402");
      expect(response.payment?.amount.currency).toBe("SATS");
      expect(response.payment?.amount.cents).toBe(200n);
    });

    it("should record L402 payment with lightning network in history", async () => {
      const l402Quote = makeL402Quote(500n);
      const l402Adapter = { name: "l402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: l402Adapter, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );

      const client = new BoltzPay(dualConfig);
      await client.fetch("https://l402-api.example.com/data");

      const history = client.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.protocol).toBe("l402");
      expect(history[0]?.network).toBe("lightning");
      expect(history[0]?.amount.currency).toBe("SATS");
      expect(history[0]?.txHash).toBeUndefined();
    });

    it("should emit payment event with L402 metadata", async () => {
      const l402Quote = makeL402Quote(100n);
      const l402Adapter = { name: "l402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: l402Adapter, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );

      const paymentListener = vi.fn();
      const client = new BoltzPay(dualConfig);
      client.on("payment", paymentListener);

      await client.fetch("https://l402-api.example.com/data");

      expect(paymentListener).toHaveBeenCalledTimes(1);
      const record = paymentListener.mock.calls[0]![0];
      expect(record.protocol).toBe("l402");
      expect(record.network).toBe("lightning");
      expect(record.amount.toDisplayString()).toBe("100 sats");
    });
  });

  // ─── Mixed x402 + L402 usage ───────────────────────────────────

  describe("mixed protocol usage in single session", () => {
    it("should track both x402 and L402 payments in history", async () => {
      const client = new BoltzPay(dualConfig);

      // First call: x402
      const x402Quote = makeX402Quote(100n);
      const x402Adapter = { name: "x402" };
      mockProbeAll.mockResolvedValueOnce([
        { adapter: x402Adapter, quote: x402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());
      await client.fetch("https://x402-api.example.com/data");

      // Second call: L402
      const l402Quote = makeL402Quote(300n);
      const l402Adapter = { name: "l402" };
      mockProbeAll.mockResolvedValueOnce([
        { adapter: l402Adapter, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );
      await client.fetch("https://l402-api.example.com/data");

      const history = client.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]?.protocol).toBe("x402");
      expect(history[0]?.amount.currency).toBe("USD");
      expect(history[1]?.protocol).toBe("l402");
      expect(history[1]?.amount.currency).toBe("SATS");
    });

    it("should count USD budget only for x402, not L402", async () => {
      const client = new BoltzPay({
        ...dualConfig,
        budget: { daily: "5.00" },
      });

      // L402 payment (500 sats) — converted to USD at default rate (0.001 USD/sat)
      // 500 sats * 0.001 USD/sat = $0.50 = 50 cents
      const l402Quote = makeL402Quote(500n);
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );
      await client.fetch("https://l402-api.example.com/data");

      const budgetAfterL402 = client.getBudget();
      expect(budgetAfterL402.dailySpent.cents).toBe(50n); // 500 sats → $0.50

      // x402 payment ($1.00) — should affect USD budget
      const x402Quote = makeX402Quote(100n);
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "x402" }, quote: x402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());
      await client.fetch("https://x402-api.example.com/data");

      const budgetAfterX402 = client.getBudget();
      expect(budgetAfterX402.dailySpent.cents).toBe(150n); // $0.50 + $1.00
    });
  });

  // ─── Fallback between protocols ─────────────────────────────────

  describe("cross-protocol fallback", () => {
    it("falls back from x402 to L402 when x402 execution fails", async () => {
      const x402Quote = makeX402Quote(100n);
      const l402Quote = makeL402Quote(200n);
      const x402Adapter = { name: "x402" };
      const l402Adapter = { name: "l402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: x402Adapter, quote: x402Quote },
        { adapter: l402Adapter, quote: l402Quote },
      ]);
      // x402 fails
      mockExecute.mockRejectedValueOnce(
        new Error("x402 payment signature failed"),
      );
      // L402 succeeds
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch("https://dual-api.example.com/data");

      expect(response.ok).toBe(true);
      expect(response.protocol).toBe("l402");
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it("falls back from L402 to x402 when L402 execution fails", async () => {
      const x402Quote = makeX402Quote(100n);
      const l402Quote = makeL402Quote(200n);
      const x402Adapter = { name: "x402" };
      const l402Adapter = { name: "l402" };

      // Note: probeAll returns in registration order (x402 first)
      // but we simulate x402 succeeding as fallback after L402 is first
      mockProbeAll.mockResolvedValueOnce([
        { adapter: l402Adapter, quote: l402Quote },
        { adapter: x402Adapter, quote: x402Quote },
      ]);
      // L402 fails (NWC timeout)
      mockExecute.mockRejectedValueOnce(new Error("NWC payment timeout"));
      // x402 succeeds
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch("https://dual-api.example.com/data");

      expect(response.ok).toBe(true);
      expect(response.protocol).toBe("x402");
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it("throws AggregatePaymentError when both protocols fail", async () => {
      const x402Quote = makeX402Quote(100n);
      const l402Quote = makeL402Quote(200n);
      const x402Adapter = { name: "x402" };
      const l402Adapter = { name: "l402" };

      mockProbeAll.mockResolvedValueOnce([
        { adapter: x402Adapter, quote: x402Quote },
        { adapter: l402Adapter, quote: l402Quote },
      ]);
      mockExecute.mockRejectedValueOnce(new Error("x402 wallet drained"));
      mockExecute.mockRejectedValueOnce(new Error("NWC unreachable"));

      const errorListener = vi.fn();
      const client = new BoltzPay(dualConfig);
      client.on("error", errorListener);

      await expect(
        client.fetch("https://dual-api.example.com/data"),
      ).rejects.toThrow(ProtocolError);

      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(errorListener).toHaveBeenCalled();
    });

    it("does not fall back if first adapter succeeds", async () => {
      const x402Quote = makeX402Quote(50n);
      const l402Quote = makeL402Quote(100n);

      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "x402" }, quote: x402Quote },
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch("https://dual-api.example.com/data");

      expect(response.protocol).toBe("x402");
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Budget isolation ───────────────────────────────────────────

  describe("budget enforcement for L402 via sats-to-USD conversion", () => {
    it("L402 payment within maxAmount passes after conversion", async () => {
      // 5 sats * 0.001 USD/sat = $0.005 = 0 cents (rounds to minimum 1 cent)
      const l402Quote = makeL402Quote(5n);
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch(
        "https://l402-api.example.com/cheap",
        { maxAmount: "0.05" },
      );

      expect(response.ok).toBe(true);
      expect(response.protocol).toBe("l402");
    });

    it("x402 payment respects maxAmount check", async () => {
      const x402Quote = makeX402Quote(1000n); // $10.00
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "x402" }, quote: x402Quote },
      ]);

      const client = new BoltzPay(dualConfig);

      await expect(
        client.fetch("https://x402-api.example.com/expensive", {
          maxAmount: "5.00",
        }),
      ).rejects.toThrow(BudgetExceededError);
    });

    it("L402 payment converted to USD counts toward daily budget", async () => {
      const client = new BoltzPay({
        ...dualConfig,
        budget: { daily: "5.00" }, // $5.00 daily limit
      });

      // 200 sats * 0.001 USD/sat = $0.20 = 20 cents
      const l402Quote = makeL402Quote(200n);
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );

      const response = await client.fetch(
        "https://l402-api.example.com/data",
      );
      expect(response.ok).toBe(true);

      // 200 sats → 20 cents in budget
      expect(client.getBudget().dailySpent.cents).toBe(20n);
    });

    it("x402 payment triggers daily budget exceeded", async () => {
      const client = new BoltzPay({
        ...dualConfig,
        budget: { daily: "0.50" }, // $0.50 daily limit
      });

      const x402Quote = makeX402Quote(100n); // $1.00
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "x402" }, quote: x402Quote },
      ]);

      await expect(
        client.fetch("https://x402-api.example.com/data"),
      ).rejects.toThrow(BudgetExceededError);
    });
  });

  // ─── Quote method ───────────────────────────────────────────────

  describe("quote() protocol agnostic", () => {
    it("should return x402 quote with USD amount", async () => {
      const x402Quote = makeX402Quote(150n);
      mockProbe.mockResolvedValueOnce({
        adapter: { name: "x402" },
        quote: x402Quote,
      });

      const client = new BoltzPay(dualConfig);
      const result = await client.quote("https://x402-api.example.com/data");

      expect(result.protocol).toBe("x402");
      expect(result.amount.currency).toBe("USD");
      expect(result.amount.cents).toBe(150n);
      expect(result.network).toBe("eip155:8453");
    });

    it("should return L402 quote with SATS amount", async () => {
      const l402Quote = makeL402Quote(200n);
      mockProbe.mockResolvedValueOnce({
        adapter: { name: "l402" },
        quote: l402Quote,
      });

      const client = new BoltzPay(dualConfig);
      const result = await client.quote("https://l402-api.example.com/data");

      expect(result.protocol).toBe("l402");
      expect(result.amount.currency).toBe("SATS");
      expect(result.amount.cents).toBe(200n);
      expect(result.amount.toDisplayString()).toBe("200 sats");
      expect(result.network).toBe("lightning");
    });

    it("should throw when no protocol detected", async () => {
      mockProbe.mockRejectedValueOnce(
        new ProtocolDetectionFailedError("https://free.example.com"),
      );

      const client = new BoltzPay(dualConfig);

      await expect(
        client.quote("https://free.example.com"),
      ).rejects.toThrow(ProtocolError);
    });
  });

  // ─── Protocol detection priority ────────────────────────────────

  describe("protocol detection priority", () => {
    it("x402 takes priority over L402 when both detect", async () => {
      const x402Quote = makeX402Quote(100n);
      const l402Quote = makeL402Quote(200n);

      // probeAll returns both in order (x402 first by registration)
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "x402" }, quote: x402Quote },
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch("https://dual.api.com/data");

      expect(response.protocol).toBe("x402");
      expect(mockExecute).toHaveBeenCalledTimes(1);

      // Verify the execute call received x402 quote amount
      const executeCall = mockExecute.mock.calls[0]!;
      expect(executeCall[1].amount.cents).toBe(100n);
    });

    it("L402 is used when only L402 detects", async () => {
      const l402Quote = makeL402Quote(500n);

      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch("https://l402-only.api.com/data");

      expect(response.protocol).toBe("l402");
    });

    it("x402 is used when only x402 detects", async () => {
      const x402Quote = makeX402Quote(50n);

      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "x402" }, quote: x402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(makeSuccessResult());

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch("https://x402-only.api.com/data");

      expect(response.protocol).toBe("x402");
    });
  });

  // ─── Free endpoint passthrough ──────────────────────────────────

  describe("free endpoint passthrough with dual config", () => {
    it("passes through to native fetch when no protocol detected", async () => {
      const fetchOriginal = globalThis.fetch;
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response('{"free":true}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      try {
        mockProbeAll.mockRejectedValueOnce(
          new ProtocolDetectionFailedError("https://free.example.com"),
        );

        const client = new BoltzPay(dualConfig);
        const response = await client.fetch("https://free.example.com");

        expect(response.ok).toBe(true);
        expect(response.payment).toBeUndefined();
        expect(response.protocol).toBeUndefined();
      } finally {
        globalThis.fetch = fetchOriginal;
      }
    });
  });

  // ─── Response content ───────────────────────────────────────────

  describe("response content across protocols", () => {
    it("x402 response supports .json()", async () => {
      const x402Quote = makeX402Quote(100n);
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "x402" }, quote: x402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({
          responseBody: new TextEncoder().encode('{"result":"x402_data"}'),
        }),
      );

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch("https://x402.api.com/data");
      const json = await response.json<{ result: string }>();

      expect(json.result).toBe("x402_data");
    });

    it("L402 response supports .json()", async () => {
      const l402Quote = makeL402Quote(200n);
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({
          externalTxHash: undefined,
          responseBody: new TextEncoder().encode('{"result":"l402_data"}'),
        }),
      );

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch("https://l402.api.com/data");
      const json = await response.json<{ result: string }>();

      expect(json.result).toBe("l402_data");
    });

    it("L402 response supports .text()", async () => {
      const l402Quote = makeL402Quote(50n);
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({
          externalTxHash: undefined,
          responseBody: new TextEncoder().encode("Lightning fast response"),
        }),
      );

      const client = new BoltzPay(dualConfig);
      const response = await client.fetch("https://l402.api.com/data");

      expect(await response.text()).toBe("Lightning fast response");
    });
  });

  // ─── Payment event protocol metadata ────────────────────────────

  describe("payment events carry correct protocol metadata", () => {
    it("x402 payment event has txHash and USD amount", async () => {
      const x402Quote = makeX402Quote(250n);
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "x402" }, quote: x402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: "0xabc123def" }),
      );

      const paymentListener = vi.fn();
      const client = new BoltzPay(dualConfig);
      client.on("payment", paymentListener);
      await client.fetch("https://x402.api.com/data");

      const record = paymentListener.mock.calls[0]![0];
      expect(record.protocol).toBe("x402");
      expect(record.txHash).toBe("0xabc123def");
      expect(record.amount.currency).toBe("USD");
      expect(record.amount.toDisplayString()).toBe("$2.50");
      expect(record.network).toBe("eip155:8453");
    });

    it("L402 payment event has no txHash and SATS amount", async () => {
      const l402Quote = makeL402Quote(1000n);
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );

      const paymentListener = vi.fn();
      const client = new BoltzPay(dualConfig);
      client.on("payment", paymentListener);
      await client.fetch("https://l402.api.com/data");

      const record = paymentListener.mock.calls[0]![0];
      expect(record.protocol).toBe("l402");
      expect(record.txHash).toBeUndefined();
      expect(record.amount.currency).toBe("SATS");
      expect(record.amount.toDisplayString()).toBe("1000 sats");
      expect(record.network).toBe("lightning");
    });
  });

  // ─── Error propagation ──────────────────────────────────────────

  describe("protocol-specific error propagation", () => {
    it("L402 credential error surfaces cleanly at SDK level", async () => {
      const l402Quote = makeL402Quote(100n);

      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockRejectedValueOnce(
        new Error(
          "L402 protocol detected but NWC wallet not configured",
        ),
      );

      const errorListener = vi.fn();
      const client = new BoltzPay(x402OnlyConfig); // No NWC
      client.on("error", errorListener);

      await expect(
        client.fetch("https://l402-api.example.com/data"),
      ).rejects.toThrow(ProtocolError);

      expect(errorListener).toHaveBeenCalled();
    });

    it("payment failure does not pollute history", async () => {
      const x402Quote = makeX402Quote(100n);
      const l402Quote = makeL402Quote(200n);

      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "x402" }, quote: x402Quote },
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockRejectedValueOnce(new Error("x402 failed"));
      mockExecute.mockRejectedValueOnce(new Error("l402 failed"));

      const client = new BoltzPay(dualConfig);

      await expect(
        client.fetch("https://failing.api.com/data"),
      ).rejects.toThrow();

      expect(client.getHistory()).toHaveLength(0);
    });
  });

  // ─── POST method with L402 ──────────────────────────────────────

  describe("POST method forwarding", () => {
    it("should forward POST method and body for L402 payment", async () => {
      const l402Quote = makeL402Quote(100n);
      mockProbeAll.mockResolvedValueOnce([
        { adapter: { name: "l402" }, quote: l402Quote },
      ]);
      mockExecute.mockResolvedValueOnce(
        makeSuccessResult({ externalTxHash: undefined }),
      );

      const client = new BoltzPay(dualConfig);
      const body = new TextEncoder().encode('{"query":"test"}');

      const response = await client.fetch(
        "https://l402-api.example.com/query",
        { method: "POST", body },
      );

      expect(response.ok).toBe(true);
      // Verify execute received the POST method and body
      const executeCall = mockExecute.mock.calls[0]!;
      expect(executeCall[1].method).toBe("POST");
      expect(executeCall[1].body).toEqual(body);
    });
  });
});
