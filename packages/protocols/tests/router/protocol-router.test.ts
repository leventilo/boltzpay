import {
  Money,
  type ProtocolAdapter,
  ProtocolDetectionFailedError,
  type ProtocolQuote,
  type ProtocolResult,
} from "@boltzpay/core";
import { describe, expect, it, vi } from "vitest";
import type {
  ProbeResult,
  ResponseAwareAdapter,
} from "../../src/router/protocol-router";
import { ProtocolRouter } from "../../src/router/protocol-router";

function mockAdapter(
  name: string,
  detects: boolean,
  quote?: Partial<ProtocolQuote>,
): ProtocolAdapter {
  return {
    name,
    detect: vi.fn().mockResolvedValue(detects),
    quote: vi.fn().mockResolvedValue({
      amount: Money.fromCents(100n),
      protocol: name,
      network: "eip155:84532",
      payTo: "0xabc",
      ...quote,
    }),
    execute: vi.fn().mockResolvedValue({
      success: true,
      externalTxHash: "0xtx",
      responseBody: undefined,
      responseHeaders: {},
      responseStatus: 200,
    } satisfies ProtocolResult),
  };
}

describe("ProtocolRouter", () => {
  describe("probe", () => {
    it("should return first matching adapter and its quote", async () => {
      const x402 = mockAdapter("x402", true);
      const l402 = mockAdapter("l402", false);
      const router = new ProtocolRouter([x402, l402]);

      const result = await router.probe("https://example.com");

      expect(result.adapter.name).toBe("x402");
      expect(result.quote.amount.cents).toBe(100n);
      expect(x402.quote).toHaveBeenCalledWith("https://example.com", undefined);
    });

    it("should throw ProtocolDetectionFailedError when no adapter matches", async () => {
      const x402 = mockAdapter("x402", false);
      const l402 = mockAdapter("l402", false);
      const router = new ProtocolRouter([x402, l402]);

      await expect(router.probe("https://example.com")).rejects.toThrow(
        ProtocolDetectionFailedError,
      );
    });

    it("should respect adapter priority order", async () => {
      const x402 = mockAdapter("x402", true, { amount: Money.fromCents(50n) });
      const l402 = mockAdapter("l402", true, { amount: Money.fromCents(200n) });
      const router = new ProtocolRouter([x402, l402]);

      const result = await router.probe("https://example.com");

      expect(result.adapter.name).toBe("x402");
      expect(result.quote.amount.cents).toBe(50n);
    });

    it("should pass headers to detect and quote", async () => {
      const x402 = mockAdapter("x402", true);
      const router = new ProtocolRouter([x402]);
      const headers = { Authorization: "Bearer test" };

      await router.probe("https://example.com", headers);

      expect(x402.detect).toHaveBeenCalledWith("https://example.com", headers);
      expect(x402.quote).toHaveBeenCalledWith("https://example.com", headers);
    });

    it("should handle adapter detection failures gracefully", async () => {
      const failingAdapter: ProtocolAdapter = {
        name: "failing",
        detect: vi.fn().mockRejectedValue(new Error("detection failed")),
        quote: vi.fn(),
        execute: vi.fn(),
      };
      const working = mockAdapter("x402", true);
      const router = new ProtocolRouter([failingAdapter, working]);

      const result = await router.probe("https://example.com");
      expect(result.adapter.name).toBe("x402");
    });
  });

  describe("probeAll", () => {
    it("should return single result when one adapter detects", async () => {
      const x402 = mockAdapter("x402", true);
      const l402 = mockAdapter("l402", false);
      const router = new ProtocolRouter([x402, l402]);

      const results = await router.probeAll("https://example.com");

      expect(results).toHaveLength(1);
      expect(results[0]?.adapter.name).toBe("x402");
      expect(results[0]?.quote.amount.cents).toBe(100n);
    });

    it("should return multiple results when both adapters detect", async () => {
      const x402 = mockAdapter("x402", true, {
        amount: Money.fromCents(100n),
      });
      const l402 = mockAdapter("l402", true, { amount: Money.fromCents(500n) });
      const router = new ProtocolRouter([x402, l402]);

      const results = await router.probeAll("https://example.com");

      expect(results).toHaveLength(2);
      expect(results[0]?.adapter.name).toBe("x402");
      expect(results[0]?.quote.amount.cents).toBe(100n);
      expect(results[1]?.adapter.name).toBe("l402");
      expect(results[1]?.quote.amount.cents).toBe(500n);
    });

    it("should throw ProtocolDetectionFailedError when no adapter detects", async () => {
      const x402 = mockAdapter("x402", false);
      const l402 = mockAdapter("l402", false);
      const router = new ProtocolRouter([x402, l402]);

      await expect(router.probeAll("https://example.com")).rejects.toThrow(
        ProtocolDetectionFailedError,
      );
    });

    it("should return only detected adapters when one fails detection", async () => {
      const x402 = mockAdapter("x402", true);
      const failing: ProtocolAdapter = {
        name: "failing",
        detect: vi.fn().mockRejectedValue(new Error("detect boom")),
        quote: vi.fn(),
        execute: vi.fn(),
      };
      const router = new ProtocolRouter([x402, failing]);

      const results = await router.probeAll("https://example.com");

      expect(results).toHaveLength(1);
      expect(results[0]?.adapter.name).toBe("x402");
    });

    it("should skip adapter with failed quote and return remaining", async () => {
      const x402 = mockAdapter("x402", true);
      const l402WithBadQuote: ProtocolAdapter = {
        name: "l402",
        detect: vi.fn().mockResolvedValue(true),
        quote: vi.fn().mockRejectedValue(new Error("quote failed")),
        execute: vi.fn(),
      };
      const router = new ProtocolRouter([x402, l402WithBadQuote]);

      const results = await router.probeAll("https://example.com");

      expect(results).toHaveLength(1);
      expect(results[0]?.adapter.name).toBe("x402");
    });

    it("should throw when all detected adapters fail to produce quotes", async () => {
      const badQuote1: ProtocolAdapter = {
        name: "bad1",
        detect: vi.fn().mockResolvedValue(true),
        quote: vi.fn().mockRejectedValue(new Error("quote1 failed")),
        execute: vi.fn(),
      };
      const badQuote2: ProtocolAdapter = {
        name: "bad2",
        detect: vi.fn().mockResolvedValue(true),
        quote: vi.fn().mockRejectedValue(new Error("quote2 failed")),
        execute: vi.fn(),
      };
      const router = new ProtocolRouter([badQuote1, badQuote2]);

      await expect(router.probeAll("https://example.com")).rejects.toThrow(
        ProtocolDetectionFailedError,
      );
    });

    it("should preserve adapter registration order (x402 first, l402 second)", async () => {
      const x402 = mockAdapter("x402", true, {
        amount: Money.fromCents(50n),
      });
      const l402 = mockAdapter("l402", true, { amount: Money.fromCents(200n) });
      const router = new ProtocolRouter([x402, l402]);

      const results = await router.probeAll("https://example.com");

      expect(results.map((r: ProbeResult) => r.adapter.name)).toEqual([
        "x402",
        "l402",
      ]);
    });

    it("should pass headers to detect and quote", async () => {
      const x402 = mockAdapter("x402", true);
      const router = new ProtocolRouter([x402]);
      const headers = { Authorization: "Bearer test" };

      await router.probeAll("https://example.com", headers);

      expect(x402.detect).toHaveBeenCalledWith("https://example.com", headers);
      expect(x402.quote).toHaveBeenCalledWith("https://example.com", headers);
    });
  });

  describe("execute", () => {
    it("should delegate to adapter execute", async () => {
      const x402 = mockAdapter("x402", true);
      const router = new ProtocolRouter([x402]);
      const request = {
        url: "https://example.com",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromCents(100n),
      };

      const result = await router.execute(x402, request);

      expect(result.success).toBe(true);
      expect(x402.execute).toHaveBeenCalledWith(request);
    });
  });

  describe("probeFromResponse", () => {
    function mockResponseAwareAdapter(
      name: string,
      quoteResult: ProtocolQuote | null,
    ): ResponseAwareAdapter {
      return {
        ...mockAdapter(name, false),
        quoteFromResponse: vi.fn().mockResolvedValue(quoteResult),
      };
    }

    it("should detect L402 from 402 response via quoteFromResponse", async () => {
      const l402Quote: ProtocolQuote = {
        amount: Money.fromCents(200n),
        protocol: "l402",
        network: "lightning",
        payTo: undefined,
      };
      const l402 = mockResponseAwareAdapter("l402", l402Quote);
      const x402 = mockResponseAwareAdapter("x402", null);
      const router = new ProtocolRouter([x402, l402]);

      const response = new Response(null, { status: 402 });
      const results = await router.probeFromResponse(response);

      expect(results).toHaveLength(1);
      expect(results[0]?.adapter.name).toBe("l402");
      expect(results[0]?.quote.amount.cents).toBe(200n);
    });

    it("should detect x402 from 402 response via quoteFromResponse", async () => {
      const x402Quote: ProtocolQuote = {
        amount: Money.fromCents(100n),
        protocol: "x402",
        network: "eip155:8453",
        payTo: "0xpay",
      };
      const x402 = mockResponseAwareAdapter("x402", x402Quote);
      const l402 = mockResponseAwareAdapter("l402", null);
      const router = new ProtocolRouter([x402, l402]);

      const response = new Response(null, { status: 402 });
      const results = await router.probeFromResponse(response);

      expect(results).toHaveLength(1);
      expect(results[0]?.adapter.name).toBe("x402");
      expect(results[0]?.quote.amount.cents).toBe(100n);
    });

    it("should return empty array for non-402 response", async () => {
      const l402 = mockResponseAwareAdapter("l402", {
        amount: Money.fromCents(100n),
        protocol: "l402",
        network: "lightning",
        payTo: undefined,
      });
      const router = new ProtocolRouter([l402]);

      const response = new Response("ok", { status: 200 });
      const results = await router.probeFromResponse(response);

      expect(results).toHaveLength(0);
    });

    it("should return empty array when no adapter recognizes the 402", async () => {
      const x402 = mockResponseAwareAdapter("x402", null);
      const l402 = mockResponseAwareAdapter("l402", null);
      const router = new ProtocolRouter([x402, l402]);

      const response = new Response(null, { status: 402 });
      const results = await router.probeFromResponse(response);

      expect(results).toHaveLength(0);
    });

    it("should return multiple results when both adapters recognize the 402", async () => {
      const x402 = mockResponseAwareAdapter("x402", {
        amount: Money.fromCents(100n),
        protocol: "x402",
        network: "eip155:8453",
        payTo: "0xpay",
      });
      const l402 = mockResponseAwareAdapter("l402", {
        amount: Money.fromCents(200n),
        protocol: "l402",
        network: "lightning",
        payTo: undefined,
      });
      const router = new ProtocolRouter([x402, l402]);

      const response = new Response(null, { status: 402 });
      const results = await router.probeFromResponse(response);

      expect(results).toHaveLength(2);
    });

    it("should skip adapters without quoteFromResponse (non-ResponseAware)", async () => {
      const plainAdapter = mockAdapter("plain", false);
      const l402 = mockResponseAwareAdapter("l402", {
        amount: Money.fromCents(200n),
        protocol: "l402",
        network: "lightning",
        payTo: undefined,
      });
      const router = new ProtocolRouter([plainAdapter, l402]);

      const response = new Response(null, { status: 402 });
      const results = await router.probeFromResponse(response);

      expect(results).toHaveLength(1);
      expect(results[0]?.adapter.name).toBe("l402");
    });

    it("should skip adapter that throws from quoteFromResponse", async () => {
      const failing: ResponseAwareAdapter = {
        ...mockAdapter("failing", false),
        quoteFromResponse: vi.fn().mockRejectedValue(new Error("parse boom")),
      };
      const l402 = mockResponseAwareAdapter("l402", {
        amount: Money.fromCents(200n),
        protocol: "l402",
        network: "lightning",
        payTo: undefined,
      });
      const router = new ProtocolRouter([failing, l402]);

      const response = new Response(null, { status: 402 });
      const results = await router.probeFromResponse(response);

      expect(results).toHaveLength(1);
      expect(results[0]?.adapter.name).toBe("l402");
    });
  });

  describe("getAdapterByName", () => {
    it("should find adapter by name", () => {
      const x402 = mockAdapter("x402", true);
      const l402 = mockAdapter("l402", false);
      const router = new ProtocolRouter([x402, l402]);

      expect(router.getAdapterByName("x402")).toBe(x402);
      expect(router.getAdapterByName("l402")).toBe(l402);
    });

    it("should return undefined for unknown adapter", () => {
      const router = new ProtocolRouter([mockAdapter("x402", true)]);

      expect(router.getAdapterByName("unknown")).toBeUndefined();
    });
  });
});
