import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MppPaymentError, MppQuoteError } from "../../src/adapter-error";
import { MppMethodSelector } from "../../src/mpp/mpp-method-selector";
import { MppAdapter } from "../../src/mpp/mpp-adapter";

function encodeBase64Url(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  const base64 = btoa(json);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildMppHeader(methods: readonly { method: string; intent?: string; request?: Record<string, unknown> }[]): string {
  return methods.map((m) => {
    const parts = [`method=${m.method}`, `intent=${m.intent ?? "charge"}`];
    if (m.request) {
      parts.push(`request=${encodeBase64Url(m.request)}`);
    }
    return `Payment ${parts.join(" ")}`;
  }).join(", ");
}

function mockResponse(status: number, headers?: Record<string, string>): Response {
  return new Response(null, { status, headers });
}

function mockMppResponse(methods: readonly { method: string; intent?: string; request?: Record<string, unknown> }[]): Response {
  const header = buildMppHeader(methods);
  return mockResponse(402, { "www-authenticate": header });
}

const stripeRequest = {
  amount: "500",
  currency: "USD",
  recipient: "acct_123",
};

const tempoRequest = {
  amount: "1000000",
  currency: "USDC",
  recipient: "0xabc",
  methodDetails: { chainId: 42161 },
};

function defaultAdapter(): MppAdapter {
  const selector = new MppMethodSelector(new Set(), []);
  const validateUrl = () => {};
  return new MppAdapter(selector, validateUrl);
}

function adapterWithValidation(validateUrl: (url: string) => void): MppAdapter {
  const selector = new MppMethodSelector(new Set(), []);
  return new MppAdapter(selector, validateUrl);
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("MppAdapter", () => {
  it("has name 'mpp'", () => {
    const adapter = defaultAdapter();
    expect(adapter.name).toBe("mpp");
  });

  describe("detect()", () => {
    it("returns true for 402 with MPP Payment header", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockMppResponse([{ method: "tempo", request: tempoRequest }]),
      );
      const adapter = defaultAdapter();
      const result = await adapter.detect("https://api.example.com/resource");
      expect(result).toBe(true);
    });

    it("returns false for 402 without MPP header", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(402),
      );
      const adapter = defaultAdapter();
      const result = await adapter.detect("https://api.example.com/resource");
      expect(result).toBe(false);
    });

    it("returns false for 200 response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(200),
      );
      const adapter = defaultAdapter();
      const result = await adapter.detect("https://api.example.com/resource");
      expect(result).toBe(false);
    });

    it("returns false for 402 with Bearer header (not MPP)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(402, { "www-authenticate": "Bearer realm=api" }),
      );
      const adapter = defaultAdapter();
      const result = await adapter.detect("https://api.example.com/resource");
      expect(result).toBe(false);
    });

    it("throws MppQuoteError on network error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const adapter = defaultAdapter();
      await expect(
        adapter.detect("https://api.example.com/resource"),
      ).rejects.toThrow(MppQuoteError);
    });

    it("calls validateUrl before fetching", async () => {
      const validateUrl = vi.fn();
      const adapter = adapterWithValidation(validateUrl);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(200));
      await adapter.detect("https://api.example.com/resource");
      expect(validateUrl).toHaveBeenCalledWith("https://api.example.com/resource");
      expect(validateUrl).toHaveBeenCalledBefore(globalThis.fetch as ReturnType<typeof vi.fn>);
    });

    it("respects detect timeout", async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        expect(init?.signal).toBeDefined();
        return Promise.resolve(mockResponse(200));
      });
      const selector = new MppMethodSelector(new Set(), []);
      const adapter = new MppAdapter(selector, () => {}, { detect: 5_000 });
      await adapter.detect("https://api.example.com/resource");
      expect(globalThis.fetch).toHaveBeenCalledOnce();
    });
  });

  describe("quote()", () => {
    it("returns ProtocolQuote with protocol=mpp and selected method", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockMppResponse([{ method: "stripe", request: stripeRequest }]),
      );
      const adapter = defaultAdapter();
      const quote = await adapter.quote("https://api.example.com/resource");
      expect(quote.protocol).toBe("mpp");
      expect(quote.scheme).toBe("mpp");
      expect(quote.selectedMethod).toBe("stripe");
    });

    it("returns quote with correct Money for Stripe method (fromCents)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockMppResponse([{ method: "stripe", request: stripeRequest }]),
      );
      const adapter = defaultAdapter();
      const quote = await adapter.quote("https://api.example.com/resource");
      expect(quote.amount.cents).toBe(500n);
      expect(quote.amount.currency).toBe("USD");
    });

    it("returns quote with correct Money for Tempo/USDC method (usdcAtomicToCents)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockMppResponse([{ method: "tempo", request: tempoRequest }]),
      );
      const adapter = defaultAdapter();
      const quote = await adapter.quote("https://api.example.com/resource");
      // 1_000_000 atomic / 10_000 = 100 cents = $1.00
      expect(quote.amount.cents).toBe(100n);
    });

    it("returns allMethods when multiple methods available", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockMppResponse([
          { method: "tempo", request: tempoRequest },
          { method: "stripe", request: stripeRequest },
        ]),
      );
      const adapter = defaultAdapter();
      const quote = await adapter.quote("https://api.example.com/resource");
      expect(quote.allMethods).toBeDefined();
      expect(quote.allMethods).toHaveLength(2);
    });

    it("returns priceUnknown=true when challenge has no request", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockMppResponse([{ method: "tempo" }]),
      );
      const adapter = defaultAdapter();
      const quote = await adapter.quote("https://api.example.com/resource");
      expect(quote.priceUnknown).toBe(true);
      expect(quote.amount.isZero()).toBe(true);
    });

    it("throws MppQuoteError for non-402 response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(200));
      const adapter = defaultAdapter();
      await expect(
        adapter.quote("https://api.example.com/resource"),
      ).rejects.toThrow(MppQuoteError);
    });

    it("throws MppQuoteError when no MPP header present", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(402, { "www-authenticate": "Bearer realm=api" }),
      );
      const adapter = defaultAdapter();
      await expect(
        adapter.quote("https://api.example.com/resource"),
      ).rejects.toThrow(MppQuoteError);
    });

    it("throws MppQuoteError when no challenges parsed", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(402, { "www-authenticate": "Payment" }),
      );
      const adapter = defaultAdapter();
      await expect(
        adapter.quote("https://api.example.com/resource"),
      ).rejects.toThrow(MppQuoteError);
    });

    it("calls validateUrl before fetching", async () => {
      const validateUrl = vi.fn();
      const adapter = adapterWithValidation(validateUrl);
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockMppResponse([{ method: "stripe", request: stripeRequest }]),
      );
      await adapter.quote("https://api.example.com/resource");
      expect(validateUrl).toHaveBeenCalledWith("https://api.example.com/resource");
      expect(validateUrl).toHaveBeenCalledBefore(globalThis.fetch as ReturnType<typeof vi.fn>);
    });
  });

  describe("quoteFromResponse()", () => {
    it("extracts quote from 402 response with MPP header", async () => {
      const response = mockMppResponse([{ method: "stripe", request: stripeRequest }]);
      const adapter = defaultAdapter();
      const quote = await adapter.quoteFromResponse(response);
      expect(quote).not.toBeNull();
      expect(quote!.protocol).toBe("mpp");
      expect(quote!.selectedMethod).toBe("stripe");
      expect(quote!.amount.cents).toBe(500n);
    });

    it("returns null for non-402 response", async () => {
      const response = mockResponse(200);
      const adapter = defaultAdapter();
      const quote = await adapter.quoteFromResponse(response);
      expect(quote).toBeNull();
    });

    it("returns null for 402 without MPP header", async () => {
      const response = mockResponse(402, { "www-authenticate": "Bearer realm=api" });
      const adapter = defaultAdapter();
      const quote = await adapter.quoteFromResponse(response);
      expect(quote).toBeNull();
    });

    it("returns null on parse error (tolerant)", async () => {
      const response = mockResponse(402, { "www-authenticate": "Payment method=tempo request=!!!invalid!!!" });
      const adapter = defaultAdapter();
      const quote = await adapter.quoteFromResponse(response);
      // Tolerant: should not throw, returns null or a quote with zero amount
      expect(quote === null || quote.priceUnknown === true).toBe(true);
    });

    it("does not call fetch (no network request)", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;
      const response = mockMppResponse([{ method: "stripe", request: stripeRequest }]);
      const adapter = defaultAdapter();
      await adapter.quoteFromResponse(response);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("execute()", () => {
    it("throws MppPaymentError with Phase 18 message", async () => {
      const adapter = defaultAdapter();
      await expect(
        adapter.execute({
          url: "https://api.example.com/resource",
          method: "GET",
          headers: {},
          body: undefined,
          amount: (await import("@boltzpay/core")).Money.fromCents(100n),
        }),
      ).rejects.toThrow(MppPaymentError);

      await expect(
        adapter.execute({
          url: "https://api.example.com/resource",
          method: "GET",
          headers: {},
          body: undefined,
          amount: (await import("@boltzpay/core")).Money.fromCents(100n),
        }),
      ).rejects.toThrow("Phase 18");
    });
  });
});
