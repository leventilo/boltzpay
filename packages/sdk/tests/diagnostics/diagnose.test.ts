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
const mockHasMppScheme = vi.fn().mockReturnValue(false);
const mockParseMppChallenges = vi.fn().mockReturnValue({ challenges: [] });

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
    hasMppScheme: (value: string) => mockHasMppScheme(value),
    parseMppChallenges: (value: string) => mockParseMppChallenges(value),
    usdcAtomicToCents: (atomic: bigint) => {
      if (atomic < 0n) throw new Error("Atomic units cannot be negative");
      if (atomic === 0n) return 0n;
      const ATOMIC_PER_CENT = 10_000n;
      const cents = (atomic + ATOMIC_PER_CENT - 1n) / ATOMIC_PER_CENT;
      return cents < 1n ? 1n : cents;
    },
  };
});

import * as dns from "node:dns/promises";
import { negotiatePayment } from "@boltzpay/protocols";
// Import AFTER mocks
import { BoltzPay } from "../../src/boltzpay";
import type { DiagnoseResult } from "../../src/diagnostics/diagnose";
import { classifyHealth } from "../../src/diagnostics/diagnose";

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
    mockHasMppScheme.mockReset().mockReturnValue(false);
    mockParseMppChallenges.mockReset().mockReturnValue({ challenges: [] });
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

  it("endpoint on stellar network with low latency -> health = 'healthy'", async () => {
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
    expect(result.health).toBe("healthy");
    expect(result.network).toBe("stellar:pubnet");
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

    it("GET returns 200 with invalid x-payment header -> classification = 'free_confirmed'", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response("ok", {
            status: 200,
            headers: { "x-payment": "not-valid-base64-json" },
          }),
        )
        .mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("free_confirmed");
      expect(result.isPaid).toBe(false);
    });

    it("GET returns 402 but no adapter can parse -> classification = 'ambiguous'", async () => {
      fetchSpy.mockResolvedValue(
        new Response("payment required", { status: 402 }),
      );
      mockProbeFromResponse.mockResolvedValue([]);
      mockedNegotiatePayment.mockResolvedValue(undefined);

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("ambiguous");
      expect(result.isPaid).toBe(false);
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

    it("GET 404, POST 402 -> classification = 'paid', postOnly = true", async () => {
      const quote = makeQuote();
      fetchSpy
        .mockResolvedValueOnce(new Response("", { status: 404 }))
        .mockResolvedValueOnce(make402Response());
      mockedNegotiatePayment.mockResolvedValue({ transport: "body" });
      mockProbeFromResponse.mockResolvedValue([
        { adapter: { name: "x402" }, quote },
      ]);

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("paid");
      expect(result.postOnly).toBe(true);
    });

    it("GET 405, POST 402 -> classification = 'paid', postOnly = true", async () => {
      const quote = makeQuote();
      fetchSpy
        .mockResolvedValueOnce(new Response("", { status: 405 }))
        .mockResolvedValueOnce(make402Response());
      mockedNegotiatePayment.mockResolvedValue({ transport: "body" });
      mockProbeFromResponse.mockResolvedValue([
        { adapter: { name: "x402" }, quote },
      ]);

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("paid");
      expect(result.postOnly).toBe(true);
    });

    it("GET 405, POST non-402 -> classification = 'dead', deathReason = 'http_405'", async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response("", { status: 405 }))
        .mockResolvedValueOnce(new Response("", { status: 401 }));

      const result = await agent.diagnose("https://api.example.com/data");
      expect(result.classification).toBe("dead");
      expect(result.deathReason).toBe("http_405");
      expect(result.httpStatus).toBe(405);
    });
  });
});

describe("diagnose — MPP protocol detection", () => {
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
    mockHasMppScheme.mockReset().mockReturnValue(false);
    mockParseMppChallenges.mockReset().mockReturnValue({ challenges: [] });
    mockedNegotiatePayment.mockReset();
    mockedDnsResolve.mockReset();
    mockedDnsResolve.mockResolvedValue(["127.0.0.1"] as Awaited<
      ReturnType<typeof dns.resolve>
    >);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function make402MppResponse(): Response {
    return make402Response({
      "www-authenticate": 'Payment method="tempo", intent="charge"',
    });
  }

  function makeMppChallenge(overrides?: Record<string, unknown>) {
    return {
      id: "test-id",
      method: "tempo",
      intent: "charge",
      realm: undefined,
      expires: undefined,
      request: {
        amount: "10000",
        currency: "0x20C0D54F37EF0E3B2A5E3a7C9Ab0bFe15f2F1b80",
        recipient: "0x10409f8a084D05AbC4E12A8dD8d4CeDF41F06Ce2",
        chainId: 4217,
        methodDetails: { chainId: 4217 },
      },
      ...overrides,
    };
  }

  it("402 with MPP Payment header -> classification = 'paid', protocol = 'mpp'", async () => {
    fetchSpy.mockResolvedValue(
      make402Response({
        "www-authenticate":
          'Payment id="test-id", method="tempo", intent="charge"',
      }),
    );
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({
      challenges: [makeMppChallenge()],
    });

    const result = await agent.diagnose("https://x402.browserbase.com/test");
    expect(result.classification).toBe("paid");
    expect(result.isPaid).toBe(true);
    expect(result.protocol).toBe("mpp");
    expect(result.formatVersion).toBe("mpp");
    expect(result.scheme).toBe("exact");
  });

  it("MPP tempo endpoint exposes network as eip155:chainId", async () => {
    fetchSpy.mockResolvedValue(make402MppResponse());
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({
      challenges: [makeMppChallenge()],
    });

    const result = await agent.diagnose("https://api.example.com/test");
    expect(result.network).toBe("eip155:4217");
  });

  it("MPP tempo endpoint extracts price from stablecoin atomic amount", async () => {
    fetchSpy.mockResolvedValue(make402MppResponse());
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({
      challenges: [makeMppChallenge()],
    });

    const result = await agent.diagnose("https://api.example.com/test");
    expect(result.price).toBeDefined();
    expect(result.price?.equals(Money.fromCents(1n))).toBe(true);
  });

  it("MPP stripe endpoint treats amount as cents", async () => {
    fetchSpy.mockResolvedValue(make402MppResponse());
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({
      challenges: [
        makeMppChallenge({
          method: "stripe",
          request: {
            amount: "1000",
            currency: "usd",
            recipient: "acct_test",
            chainId: undefined,
            methodDetails: undefined,
          },
        }),
      ],
    });

    const result = await agent.diagnose("https://api.example.com/test");
    expect(result.price).toBeDefined();
    expect(result.price?.equals(Money.fromCents(1000n))).toBe(true);
    expect(result.network).toBeUndefined();
  });

  it("MPP multi-method populates mppMethods array", async () => {
    fetchSpy.mockResolvedValue(make402MppResponse());
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({
      challenges: [
        makeMppChallenge({ id: "a1", method: "tempo" }),
        makeMppChallenge({
          id: "b2",
          method: "stripe",
          request: {
            amount: "1000",
            currency: "usd",
            recipient: "acct_test",
            chainId: undefined,
            methodDetails: undefined,
          },
        }),
      ],
    });

    const result = await agent.diagnose("https://api.example.com/test");
    expect(result.mppMethods).toHaveLength(2);
    expect(result.mppMethods?.[0]?.method).toBe("tempo");
    expect(result.mppMethods?.[1]?.method).toBe("stripe");
  });

  it("MPP mppMethods includes intent, id, and request details", async () => {
    fetchSpy.mockResolvedValue(make402MppResponse());
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({
      challenges: [
        makeMppChallenge({
          id: "sess-1",
          intent: "session",
          expires: "2026-04-01T00:00:00Z",
        }),
      ],
    });

    const result = await agent.diagnose("https://api.example.com/test");
    const method = result.mppMethods?.[0];
    expect(method?.intent).toBe("session");
    expect(method?.id).toBe("sess-1");
    expect(method?.expires).toBe("2026-04-01T00:00:00Z");
    expect(method?.rawAmount).toBe("10000");
    expect(method?.chainId).toBe(4217);
  });

  it("MPP facilitator address is truncated", async () => {
    fetchSpy.mockResolvedValue(make402MppResponse());
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({
      challenges: [makeMppChallenge()],
    });

    const result = await agent.diagnose("https://api.example.com/test");
    expect(result.facilitator).toBe("0x1040...6Ce2");
  });

  it("MPP without request payload -> price undefined, network undefined", async () => {
    fetchSpy.mockResolvedValue(make402MppResponse());
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({
      challenges: [
        makeMppChallenge({ request: undefined }),
      ],
    });

    const result = await agent.diagnose("https://api.example.com/test");
    expect(result.protocol).toBe("mpp");
    expect(result.price).toBeUndefined();
    expect(result.network).toBeUndefined();
    expect(result.facilitator).toBeUndefined();
  });

  it("402 with no adapter match and no MPP -> classification = 'ambiguous'", async () => {
    fetchSpy.mockResolvedValue(make402Response());
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({ challenges: [] });

    const result = await agent.diagnose("https://api.example.com/test");
    expect(result.classification).toBe("ambiguous");
    expect(result.protocol).toBeUndefined();
  });

  it("200 with MPP www-authenticate header -> classification = 'paid'", async () => {
    mockHasMppScheme.mockReturnValue(true);
    fetchSpy.mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: {
          "www-authenticate":
            'Payment method="tempo", intent="charge"',
        },
      }),
    );
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({
      challenges: [makeMppChallenge()],
    });

    const result = await agent.diagnose("https://api.example.com/test");
    expect(result.classification).toBe("paid");
    expect(result.protocol).toBe("mpp");
  });

  it("GET 200 POST 402 with MPP -> postOnly = true, protocol = 'mpp'", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(make402MppResponse());
    mockedNegotiatePayment.mockResolvedValue(undefined);
    mockParseMppChallenges.mockReturnValue({
      challenges: [makeMppChallenge()],
    });

    const result = await agent.diagnose("https://api.example.com/test");
    expect(result.classification).toBe("paid");
    expect(result.protocol).toBe("mpp");
    expect(result.postOnly).toBe(true);
  });
});

describe("classifyHealth", () => {
  it("should return healthy for fast exact-scheme endpoint", () => {
    expect(classifyHealth(200, "exact", "base")).toBe("healthy");
  });

  it("should return degraded for non-exact scheme", () => {
    expect(classifyHealth(100, "upto", "base")).toBe("degraded");
  });

  it("should return degraded for slow non-stellar endpoint (>1000ms)", () => {
    expect(classifyHealth(1500, "exact", "base")).toBe("degraded");
  });

  it("should return healthy for stellar endpoint under 5000ms", () => {
    expect(classifyHealth(3000, "exact", "stellar:pubnet")).toBe("healthy");
  });

  it("should return degraded for stellar endpoint over 5000ms", () => {
    expect(classifyHealth(6000, "exact", "stellar:pubnet")).toBe("degraded");
  });

  it("should return degraded for suspicious price over $100", () => {
    const expensivePrice = Money.fromDollars("150.00");
    expect(classifyHealth(100, "exact", "base", expensivePrice)).toBe("degraded");
  });

  it("should return healthy for normal price under $100", () => {
    const normalPrice = Money.fromDollars("0.05");
    expect(classifyHealth(100, "exact", "base", normalPrice)).toBe("healthy");
  });
});
