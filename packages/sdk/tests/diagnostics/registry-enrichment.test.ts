import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve: vi.fn().mockResolvedValue(["127.0.0.1"]),
}));

vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {},
}));

const mockProbeFromResponse = vi.fn();
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
    probe = vi.fn();
    probeAll = vi.fn();
    execute = vi.fn();
    probeFromResponse = mockProbeFromResponse;
  }
  class MockAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "AdapterError";
    }
  }
  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: class { name = "x402"; },
    MppAdapter: class { name = "mpp"; constructor() {} },
    MppMethodSelector: class { constructor() {} },
    L402Adapter: class { name = "l402"; },
    NwcWalletManager: class { close() {} },
    AdapterError: MockAdapterError,
    X402PaymentError: class extends MockAdapterError {
      constructor(message: string) {
        super("x402_payment_failed", message);
      }
    },
    AggregatePaymentError: class extends MockAdapterError {
      errors: readonly Error[];
      constructor(errors: readonly Error[]) {
        super("aggregate_payment_failed", `All payment attempts failed`);
        this.errors = errors;
      }
    },
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
import type { ProtocolQuote } from "@boltzpay/core";
import { Money } from "@boltzpay/core";
import { negotiatePayment } from "@boltzpay/protocols";
import type { DiagnoseResult } from "../../src/diagnostics/diagnose";
import { diagnoseEndpoint } from "../../src/diagnostics/diagnose";
import { ProtocolRouter } from "@boltzpay/protocols";

const mockedDnsResolve = vi.mocked(dns.resolve);
const mockedNegotiatePayment = vi.mocked(negotiatePayment);

function makeRouter(): ProtocolRouter {
  return new ProtocolRouter();
}

function makeRegistryResponse(endpoints: readonly Record<string, unknown>[]) {
  return {
    data: endpoints,
    total: endpoints.length,
    offset: 0,
    limit: endpoints.length,
    hasMore: false,
  };
}

function makeRegistryEndpoint(overrides?: Record<string, unknown>) {
  return {
    slug: "api-ppq-ai-v1-chat-completions",
    name: "PayPerQ: Chat Completions",
    url: "https://api.ppq.ai/v1/chat/completions",
    protocol: "mpp",
    score: 99,
    health: "healthy",
    category: "ai",
    isPaid: true,
    badge: "established",
    ...overrides,
  };
}

describe("diagnose — registry enrichment", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mockProbeFromResponse.mockReset();
    mockProbeFromResponse.mockResolvedValue([]);
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

  it("enriches ambiguous endpoint when registry knows it as paid", async () => {
    // GET returns 401 => ambiguous (no POST probe for non-2xx/non-4xx/non-5xx)
    fetchSpy
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      // Registry lookup (second fetch call — no POST probe for 401)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeRegistryResponse([makeRegistryEndpoint()]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("registry");
    expect(result.classification).toBe("paid");
    expect(result.isPaid).toBe(true);
    expect(result.protocol).toBe("mpp");
    expect(result.registryMatch).toEqual({
      protocol: "mpp",
      score: 99,
      health: "healthy",
      name: "PayPerQ: Chat Completions",
      category: "ai",
    });
  });

  it("enriches free_confirmed endpoint when registry knows it as paid", async () => {
    // GET returns 200, POST returns 200 => free_confirmed
    fetchSpy
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      // Registry lookup
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeRegistryResponse([makeRegistryEndpoint()]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("registry");
    expect(result.classification).toBe("paid");
    expect(result.isPaid).toBe(true);
    expect(result.protocol).toBe("mpp");
  });

  it("falls back gracefully when registry is down", async () => {
    // GET returns 401 => ambiguous
    fetchSpy
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      // Registry lookup fails
      .mockRejectedValueOnce(new Error("Registry unavailable"));

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("probe");
    expect(result.classification).toBe("ambiguous");
    expect(result.isPaid).toBe(false);
    expect(result.registryMatch).toBeUndefined();
  });

  it("skips registry lookup when probe detects endpoint as paid", async () => {
    const quote: ProtocolQuote = {
      amount: Money.fromDollars("0.01"),
      protocol: "x402",
      network: "eip155:8453",
      payTo: "0x1234567890abcdef1234567890abcdef12345678",
      scheme: "exact",
      allAccepts: [],
    };
    fetchSpy.mockResolvedValue(
      new Response(null, { status: 402 }),
    );
    mockProbeFromResponse.mockResolvedValue([
      { adapter: { name: "x402" }, quote },
    ]);
    mockedNegotiatePayment.mockResolvedValue({
      transport: "body",
      version: 1,
      paymentRequired: {},
      responseHeader: "X-PAYMENT",
    });

    const result = await diagnoseEndpoint({
      url: "https://x402.twit.sh/tweets/by/id",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("probe");
    expect(result.classification).toBe("paid");
    expect(result.protocol).toBe("x402");
    // Only 1 fetch call (the probe), no registry lookup
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns original probe result when endpoint is not found in registry", async () => {
    // GET returns 401 => ambiguous
    fetchSpy
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      // Registry returns empty results
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeRegistryResponse([])),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await diagnoseEndpoint({
      url: "https://unknown-api.example.com/data",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("probe");
    expect(result.classification).toBe("ambiguous");
    expect(result.isPaid).toBe(false);
    expect(result.registryMatch).toBeUndefined();
  });

  it("skips registry lookup when no registryUrl is provided", async () => {
    // GET returns 401 => ambiguous (no POST probe for 401)
    fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      // No registryUrl
    });

    expect(result.source).toBe("probe");
    expect(result.classification).toBe("ambiguous");
    // Only 1 fetch call (GET), no POST probe for 401, no registry call
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("matches by hostname when exact URL is not in registry", async () => {
    // GET returns 200, POST returns 200 => free_confirmed
    fetchSpy
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      // Registry returns different URL with same hostname
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeRegistryResponse([
              makeRegistryEndpoint({
                slug: "api-ppq-ai-v1-images",
                name: "PayPerQ: Images",
                url: "https://api.ppq.ai/v1/images",
              }),
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("registry");
    expect(result.classification).toBe("paid");
    expect(result.isPaid).toBe(true);
    expect(result.registryMatch?.name).toBe("PayPerQ: Images");
  });

  it("prefers exact URL match over hostname match", async () => {
    // GET returns 200, POST returns 200 => free_confirmed
    fetchSpy
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      // Registry returns both exact and hostname matches
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeRegistryResponse([
              makeRegistryEndpoint({
                slug: "api-ppq-ai-v1-images",
                name: "PayPerQ: Images",
                url: "https://api.ppq.ai/v1/images",
                score: 80,
              }),
              makeRegistryEndpoint({
                slug: "api-ppq-ai-v1-chat-completions",
                name: "PayPerQ: Chat Completions",
                url: "https://api.ppq.ai/v1/chat/completions",
                score: 99,
              }),
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("registry");
    expect(result.registryMatch?.name).toBe("PayPerQ: Chat Completions");
    expect(result.registryMatch?.score).toBe(99);
  });

  it("does not enrich when registry endpoint is not paid", async () => {
    // GET returns 200, POST returns 200 => free_confirmed
    fetchSpy
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      // Registry returns endpoint with isPaid: false
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeRegistryResponse([
              makeRegistryEndpoint({ isPaid: false }),
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("probe");
    expect(result.classification).toBe("free_confirmed");
    expect(result.isPaid).toBe(false);
  });

  it("does not enrich dead endpoints", async () => {
    // GET returns 500
    fetchSpy.mockResolvedValueOnce(
      new Response("Server Error", { status: 500 }),
    );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("probe");
    expect(result.classification).toBe("dead");
    // Only 1 fetch call (the probe), no registry lookup
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves original probe fields in enriched result", async () => {
    // GET returns 401 => ambiguous
    fetchSpy
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      // Registry lookup
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeRegistryResponse([makeRegistryEndpoint()]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.url).toBe("https://api.ppq.ai/v1/chat/completions");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.postOnly).toBe(false);
  });

  it("handles registry returning invalid JSON gracefully", async () => {
    // GET returns 401 => ambiguous
    fetchSpy
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      // Registry returns garbage
      .mockResolvedValueOnce(
        new Response("not json", { status: 200 }),
      );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("probe");
    expect(result.classification).toBe("ambiguous");
  });

  it("handles registry returning HTTP error gracefully", async () => {
    // GET returns 200, POST returns 200 => free_confirmed
    fetchSpy
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      // Registry returns 500
      .mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }),
      );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.source).toBe("probe");
    expect(result.classification).toBe("free_confirmed");
  });

  it("sets protocol from registry match when present", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeRegistryResponse([
              makeRegistryEndpoint({ protocol: "l402" }),
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.protocol).toBe("l402");
    expect(result.registryMatch?.protocol).toBe("l402");
  });

  it("uses 'unknown' protocol when registry match has no protocol", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeRegistryResponse([
              makeRegistryEndpoint({ protocol: undefined }),
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await diagnoseEndpoint({
      url: "https://api.ppq.ai/v1/chat/completions",
      router: makeRouter(),
      registryUrl: "https://status.boltzpay.ai",
    });

    expect(result.registryMatch?.protocol).toBe("unknown");
  });
});
