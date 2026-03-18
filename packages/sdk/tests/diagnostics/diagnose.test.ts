import type { ProtocolQuote } from "@boltzpay/core";
import { Money } from "@boltzpay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:dns/promises — default resolves successfully
vi.mock("node:dns/promises", () => ({
  resolve: vi.fn().mockResolvedValue(["127.0.0.1"]),
}));

// Mock @coinbase/cdp-sdk to prevent real imports
vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {},
}));

// Mock @boltzpay/protocols to provide controllable adapter behavior
const mockProbe = vi.fn();
const mockProbeAll = vi.fn();
const mockProbeFromResponse = vi.fn();
const mockExecute = vi.fn();

vi.mock("@boltzpay/protocols", () => {
  class MockCdpWalletManager {
    getAddresses() {
      return {};
    }
    async getBalances() {
      return {};
    }
  }
  class MockProtocolRouter {
    probe = mockProbe;
    probeAll = mockProbeAll;
    execute = mockExecute;
    probeFromResponse = mockProbeFromResponse;
  }
  class MockX402Adapter {
    name = "x402";
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
  }
  class MockNwcWalletManager {
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
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
    X402PaymentError: MockX402PaymentError,
    AggregatePaymentError: MockAggregatePaymentError,
    negotiatePayment: vi.fn(),
  };
});

import * as dns from "node:dns/promises";
import { negotiatePayment } from "@boltzpay/protocols";
// Import AFTER mocks
import { BoltzPay } from "../../src/boltzpay";
import type { DiagnoseResult } from "../../src/diagnostics/diagnose";

const mockedNegotiatePayment = vi.mocked(negotiatePayment);
const mockedDnsResolve = vi.mocked(dns.resolve);

const validConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

function make402Response(headers?: Record<string, string>): Response {
  return new Response(null, {
    status: 402,
    headers: headers ?? {},
  });
}

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

describe("diagnose — endpoint diagnostic report", () => {
  let agent: BoltzPay;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    agent = new BoltzPay(validConfig);
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mockProbe.mockReset();
    mockProbeAll.mockReset();
    mockProbeFromResponse.mockReset();
    mockProbeFromResponse.mockResolvedValue([]);
    mockExecute.mockReset();
    mockedNegotiatePayment.mockReset();
    mockedDnsResolve.mockReset();
    mockedDnsResolve.mockResolvedValue(["127.0.0.1"] as Awaited<
      ReturnType<typeof dns.resolve>
    >);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns DiagnoseResult with all required fields for a healthy endpoint", async () => {
    const quote = makeQuote();
    fetchSpy.mockResolvedValue(make402Response());
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "body",
      version: 1,
      paymentRequired: {},
      responseHeader: "X-PAYMENT",
    });

    const result: DiagnoseResult = await agent.diagnose(
      "https://api.example.com/data",
    );

    expect(result.url).toBe("https://api.example.com/data");
    expect(result.isPaid).toBe(true);
    expect(result.protocol).toBe("x402");
    expect(result.formatVersion).toBe("V1 body");
    expect(result.scheme).toBe("exact");
    expect(result.network).toBe("eip155:8453");
    expect(result.price).toBeDefined();
    expect(result.facilitator).toBeDefined();
    expect(result.health).toBe("healthy");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.postOnly).toBe(false);
  });

  it("V1 body 402 response -> formatVersion = 'V1 body'", async () => {
    const quote = makeQuote();
    fetchSpy.mockResolvedValue(make402Response());
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "body",
      version: 1,
      paymentRequired: {},
      responseHeader: "X-PAYMENT",
    });

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.formatVersion).toBe("V1 body");
  });

  it("V2 header 402 response -> formatVersion = 'V2 header'", async () => {
    const quote = makeQuote();
    fetchSpy.mockResolvedValue(
      make402Response({ "payment-required": "base64data" }),
    );
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "header",
      version: 2,
      paymentRequired: {},
      responseHeader: "PAYMENT-SIGNATURE",
    });

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.formatVersion).toBe("V2 header");
  });

  it("www-authenticate 402 response -> formatVersion = 'www-authenticate'", async () => {
    const quote = makeQuote();
    fetchSpy.mockResolvedValue(
      make402Response({ "www-authenticate": "X402 ..." }),
    );
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "www-authenticate",
      version: 2,
      paymentRequired: {},
      responseHeader: "PAYMENT-SIGNATURE",
    });

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.formatVersion).toBe("www-authenticate");
  });

  it("GET returns non-402, POST returns 402 -> postOnly = true", async () => {
    const quote = makeQuote();
    // First call (GET) returns 200, second call (POST) returns 402
    fetchSpy
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(make402Response());
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "body",
      version: 1,
      paymentRequired: {},
      responseHeader: "X-PAYMENT",
    });

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.postOnly).toBe(true);
    expect(result.isPaid).toBe(true);
  });

  it("endpoint with scheme 'upto' -> health = 'degraded'", async () => {
    const quote = makeQuote({ scheme: "upto" });
    fetchSpy.mockResolvedValue(make402Response());
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "header",
      version: 2,
      paymentRequired: {},
      responseHeader: "PAYMENT-SIGNATURE",
    });

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.health).toBe("degraded");
    expect(result.scheme).toBe("upto");
  });

  it("endpoint on stellar network -> health = 'degraded'", async () => {
    const quote = makeQuote({ network: "stellar:pubnet", scheme: "exact" });
    fetchSpy.mockResolvedValue(make402Response());
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "header",
      version: 2,
      paymentRequired: {},
      responseHeader: "PAYMENT-SIGNATURE",
    });

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.health).toBe("degraded");
  });

  it("endpoint that times out -> health = 'dead'", async () => {
    fetchSpy.mockRejectedValue(new Error("fetch failed: timeout"));

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.health).toBe("dead");
    expect(result.isPaid).toBe(false);
  });

  it("endpoint with network error -> health = 'dead'", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.health).toBe("dead");
  });

  it("facilitator address truncated to '0x1234...5678' format", async () => {
    const quote = makeQuote({
      payTo: "0xabcdef1234567890abcdef1234567890abcdef12",
    });
    fetchSpy.mockResolvedValue(make402Response());
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "body",
      version: 1,
      paymentRequired: {},
      responseHeader: "X-PAYMENT",
    });

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.facilitator).toBe("0xabcd...ef12");
  });

  it("short facilitator address is not truncated", async () => {
    const quote = makeQuote({ payTo: "short" });
    fetchSpy.mockResolvedValue(make402Response());
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "body",
      version: 1,
      paymentRequired: {},
      responseHeader: "X-PAYMENT",
    });

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.facilitator).toBe("short");
  });

  it("multi-chain endpoint populates chains[] array", async () => {
    const quote = makeQuote({
      allAccepts: [
        {
          namespace: "evm" as const,
          network: "eip155:8453",
          amount: 100n,
          payTo: "0xabc",
          scheme: "exact",
        },
        {
          namespace: "svm" as const,
          network: "solana:mainnet",
          amount: 200n,
          payTo: "SolAddr",
          scheme: "exact",
        },
      ],
    });
    fetchSpy.mockResolvedValue(make402Response());
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "body",
      version: 1,
      paymentRequired: {},
      responseHeader: "X-PAYMENT",
    });

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.chains).toHaveLength(2);
    expect(result.chains?.[0]?.namespace).toBe("evm");
    expect(result.chains?.[1]?.namespace).toBe("svm");
  });

  it("diagnose includes timing breakdown", async () => {
    const quote = makeQuote();
    fetchSpy.mockResolvedValue(make402Response());
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "body",
      version: 1,
      paymentRequired: {},
      responseHeader: "X-PAYMENT",
    });

    const result = await agent.diagnose("https://api.example.com/data");
    expect(result.timing).toBeDefined();
    expect(result.timing?.detectMs).toBeGreaterThanOrEqual(0);
    expect(result.timing?.quoteMs).toBeGreaterThanOrEqual(0);
  });

  it("non-402 free endpoint -> isPaid: false, health: healthy", async () => {
    fetchSpy.mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await agent.diagnose("https://free.example.com");
    expect(result.isPaid).toBe(false);
    expect(result.health).toBe("healthy");
  });

  describe("classification taxonomy", () => {
    it("GET fetch throws (network error) -> classification = 'dead', deathReason = 'timeout'", async () => {
      fetchSpy.mockRejectedValue(new Error("fetch failed: timeout"));

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("dead");
      expect(result.deathReason).toBe("timeout");
      expect(result.isPaid).toBe(false);
      expect(result.health).toBe("dead");
    });

    it("GET returns 404 -> classification = 'dead', deathReason = 'http_404', httpStatus = 404", async () => {
      fetchSpy.mockResolvedValue(new Response("Not Found", { status: 404 }));

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("dead");
      expect(result.deathReason).toBe("http_404");
      expect(result.httpStatus).toBe(404);
    });

    it("GET returns 500 -> classification = 'dead', deathReason = 'http_5xx', httpStatus = 500", async () => {
      fetchSpy.mockResolvedValue(new Response("Server Error", { status: 500 }));

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("dead");
      expect(result.deathReason).toBe("http_5xx");
      expect(result.httpStatus).toBe(500);
    });

    it("GET returns 503 -> classification = 'dead', deathReason = 'http_5xx', httpStatus = 503", async () => {
      fetchSpy.mockResolvedValue(
        new Response("Service Unavailable", { status: 503 }),
      );

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("dead");
      expect(result.deathReason).toBe("http_5xx");
      expect(result.httpStatus).toBe(503);
    });

    it("GET returns 402 -> classification = 'paid'", async () => {
      const quote = makeQuote();
      fetchSpy.mockResolvedValue(make402Response());
      mockProbeFromResponse.mockResolvedValue([
        { adapter: { name: "x402" }, quote },
      ]);
      mockedNegotiatePayment.mockResolvedValue({
        transport: "body",
        version: 1,
        paymentRequired: {},
        responseHeader: "X-PAYMENT",
      });

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("paid");
      expect(result.isPaid).toBe(true);
    });

    it("GET returns 200, POST returns 402 -> classification = 'paid', postOnly = true", async () => {
      const quote = makeQuote();
      fetchSpy
        .mockResolvedValueOnce(new Response("ok", { status: 200 }))
        .mockResolvedValueOnce(make402Response());
      mockProbeFromResponse.mockResolvedValue([
        { adapter: { name: "x402" }, quote },
      ]);
      mockedNegotiatePayment.mockResolvedValue({
        transport: "body",
        version: 1,
        paymentRequired: {},
        responseHeader: "X-PAYMENT",
      });

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("paid");
      expect(result.postOnly).toBe(true);
      expect(result.isPaid).toBe(true);
    });

    it("GET returns 200, POST returns 405 -> classification = 'free_confirmed'", async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response("ok", { status: 200 }))
        .mockResolvedValueOnce(
          new Response("Method Not Allowed", { status: 405 }),
        );

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("free_confirmed");
      expect(result.isPaid).toBe(false);
      expect(result.health).toBe("healthy");
    });

    it("GET returns 200, POST returns 200 -> classification = 'free_confirmed'", async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response("ok", { status: 200 }))
        .mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("free_confirmed");
      expect(result.isPaid).toBe(false);
      expect(result.health).toBe("healthy");
    });

    it("GET returns 200, POST throws error -> classification = 'ambiguous'", async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response("ok", { status: 200 }))
        .mockRejectedValueOnce(new Error("POST failed"));

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("ambiguous");
      expect(result.isPaid).toBe(false);
      expect(result.health).toBe("degraded");
    });

    it("DNS resolve fails -> classification = 'dead', deathReason = 'dns_failure', fetch NOT called", async () => {
      mockedDnsResolve.mockRejectedValue(new Error("ENOTFOUND"));

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("dead");
      expect(result.deathReason).toBe("dns_failure");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("backward compat: isPaid still true for paid, false for others; health still consistent", async () => {
      const quote = makeQuote();
      fetchSpy.mockResolvedValue(make402Response());
      mockProbeFromResponse.mockResolvedValue([
        { adapter: { name: "x402" }, quote },
      ]);
      mockedNegotiatePayment.mockResolvedValue({
        transport: "body",
        version: 1,
        paymentRequired: {},
        responseHeader: "X-PAYMENT",
      });

      const paidResult = await agent.diagnose("https://api.example.com/data");
      expect(paidResult.classification).toBe("paid");
      expect(paidResult.isPaid).toBe(true);
      expect(paidResult.health).toBe("healthy");
    });

    it("GET returns 200 with x-payment header -> classification = 'paid'", async () => {
      const quote = makeQuote();
      const validXPayment = Buffer.from(JSON.stringify({ scheme: "exact" })).toString("base64");
      fetchSpy.mockResolvedValue(
        new Response("ok", {
          status: 200,
          headers: { "x-payment": validXPayment },
        }),
      );
      mockProbeFromResponse.mockResolvedValue([
        { adapter: { name: "x402" }, quote },
      ]);
      mockedNegotiatePayment.mockResolvedValue({
        transport: "header",
        version: 2,
        paymentRequired: {},
        responseHeader: "X-PAYMENT",
      });

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("paid");
      expect(result.isPaid).toBe(true);
    });

    it("GET returns 200 with www-authenticate containing X402 -> classification = 'paid'", async () => {
      const quote = makeQuote();
      fetchSpy.mockResolvedValue(
        new Response("ok", {
          status: 200,
          headers: { "www-authenticate": 'X402 realm="test"' },
        }),
      );
      mockProbeFromResponse.mockResolvedValue([
        { adapter: { name: "x402" }, quote },
      ]);
      mockedNegotiatePayment.mockResolvedValue({
        transport: "www-authenticate",
        version: 2,
        paymentRequired: {},
        responseHeader: "PAYMENT-SIGNATURE",
      });

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("paid");
      expect(result.isPaid).toBe(true);
    });

    it("GET returns 403 -> classification = 'ambiguous'", async () => {
      fetchSpy.mockResolvedValue(new Response("Forbidden", { status: 403 }));

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("ambiguous");
      expect(result.isPaid).toBe(false);
    });

    it("GET fetch throws TLS error -> classification = 'dead', deathReason = 'tls_error'", async () => {
      fetchSpy.mockRejectedValue(
        new Error("unable to verify the first certificate (TLS)"),
      );

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("dead");
      expect(result.deathReason).toBe("tls_error");
    });
  });
});
