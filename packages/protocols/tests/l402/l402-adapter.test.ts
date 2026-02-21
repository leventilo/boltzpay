import { Money } from "@boltzpay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  L402CredentialsMissingError,
  L402PaymentError,
  L402QuoteError,
} from "../../src/adapter-error";
import { L402Adapter } from "../../src/l402/l402-adapter";
import type { NwcWalletManager } from "../../src/nwc/nwc-wallet-manager";

// Mock light-bolt11-decoder
vi.mock("light-bolt11-decoder", () => ({
  decode: (invoice: string) => {
    if (invoice === "lnbc200n1_invalid") {
      return { sections: [{ name: "timestamp", value: "123" }] };
    }
    // Default mock: 200 sats = 200000 millisats
    return {
      sections: [
        { name: "lightning_network", value: "bc" },
        { name: "amount", value: "200000" },
      ],
    };
  },
}));

const MOCK_MACAROON = "AgEMbG9jYXRpb24gaWQ";
const MOCK_INVOICE = "lnbc200n1pj_valid";

function makeL402Response(): Response {
  return new Response(null, {
    status: 402,
    headers: {
      "www-authenticate": `L402 macaroon="${MOCK_MACAROON}", invoice="${MOCK_INVOICE}"`,
    },
  });
}

function make200Response(body = '{"data":"ok"}'): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockWallet(
  overrides: Partial<NwcWalletManager> = {},
): NwcWalletManager {
  return {
    payInvoice: vi.fn().mockResolvedValue({ preimage: "abc123preimage" }),
    getBalance: vi.fn().mockResolvedValue({ balanceSats: 50000 }),
    ...overrides,
  } as unknown as NwcWalletManager;
}

const validateUrl = (url: string) => {
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
};

const fetchOriginal = globalThis.fetch;
const fetchMock = vi.fn();

describe("L402Adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    vi.clearAllMocks();
  });

  describe("detect()", () => {
    it("should return true for 402 with L402 header", async () => {
      fetchMock.mockResolvedValueOnce(makeL402Response());
      const adapter = new L402Adapter(undefined, validateUrl);

      const result = await adapter.detect("https://api.example.com/l402");
      expect(result).toBe(true);
    });

    it("should return false for 402 without L402 header", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 402,
          headers: { "www-authenticate": "Bearer realm=test" },
        }),
      );
      const adapter = new L402Adapter(undefined, validateUrl);

      const result = await adapter.detect("https://api.example.com/other");
      expect(result).toBe(false);
    });

    it("should return false for 200 response", async () => {
      fetchMock.mockResolvedValueOnce(make200Response());
      const adapter = new L402Adapter(undefined, validateUrl);

      const result = await adapter.detect("https://free.example.com");
      expect(result).toBe(false);
    });

    it("should return false for 402 without www-authenticate", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 }));
      const adapter = new L402Adapter(undefined, validateUrl);

      const result = await adapter.detect("https://api.example.com/plain402");
      expect(result).toBe(false);
    });

    it("should throw L402QuoteError on network failure", async () => {
      fetchMock.mockRejectedValueOnce(new Error("DNS resolution failed"));
      const adapter = new L402Adapter(undefined, validateUrl);

      await expect(
        adapter.detect("https://unreachable.example.com"),
      ).rejects.toThrow(L402QuoteError);
    });
  });

  describe("quote()", () => {
    it("should return quote with amount in sats", async () => {
      fetchMock.mockResolvedValueOnce(makeL402Response());
      const adapter = new L402Adapter(undefined, validateUrl);

      const quote = await adapter.quote("https://api.example.com/l402");

      expect(quote.protocol).toBe("l402");
      expect(quote.network).toBe("lightning");
      expect(quote.amount.cents).toBe(200n);
      expect(quote.amount.currency).toBe("SATS");
      expect(quote.amount.toDisplayString()).toBe("200 sats");
    });

    it("should throw L402QuoteError for non-402 response", async () => {
      fetchMock.mockResolvedValueOnce(make200Response());
      const adapter = new L402Adapter(undefined, validateUrl);

      await expect(
        adapter.quote("https://free.example.com"),
      ).rejects.toThrow(L402QuoteError);
    });

    it("should throw L402QuoteError when no WWW-Authenticate header", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 }));
      const adapter = new L402Adapter(undefined, validateUrl);

      await expect(
        adapter.quote("https://api.example.com/no-header"),
      ).rejects.toThrow(L402QuoteError);
    });

    it("should throw L402QuoteError on network failure", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Connection refused"));
      const adapter = new L402Adapter(undefined, validateUrl);

      await expect(
        adapter.quote("https://unreachable.example.com"),
      ).rejects.toThrow(L402QuoteError);
    });
  });

  describe("execute()", () => {
    const baseRequest = {
      url: "https://api.example.com/l402",
      method: "GET",
      headers: {},
      body: undefined,
      amount: Money.fromSatoshis(200n),
    };

    it("should execute full L402 payment flow", async () => {
      // First fetch returns 402
      fetchMock.mockResolvedValueOnce(makeL402Response());
      // Second fetch (with auth) returns 200
      fetchMock.mockResolvedValueOnce(make200Response('{"result":"paid"}'));

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);

      const result = await adapter.execute(baseRequest);

      expect(result.success).toBe(true);
      expect(result.responseStatus).toBe(200);
      expect(wallet.payInvoice).toHaveBeenCalledWith(MOCK_INVOICE);

      // Verify the auth header was sent on retry
      const retryCall = fetchMock.mock.calls[1];
      const retryHeaders = retryCall[1]?.headers as Record<string, string>;
      expect(retryHeaders.Authorization).toBe(
        `L402 ${MOCK_MACAROON}:abc123preimage`,
      );
    });

    it("should return directly if first request is not 402", async () => {
      fetchMock.mockResolvedValueOnce(make200Response());

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);

      const result = await adapter.execute(baseRequest);

      expect(result.success).toBe(true);
      expect(result.responseStatus).toBe(200);
      expect(wallet.payInvoice).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("should throw L402CredentialsMissingError when no wallet", async () => {
      const adapter = new L402Adapter(undefined, validateUrl);

      await expect(adapter.execute(baseRequest)).rejects.toThrow(
        L402CredentialsMissingError,
      );
    });

    it("should throw L402PaymentError when invoice payment fails", async () => {
      fetchMock.mockResolvedValueOnce(makeL402Response());

      const wallet = mockWallet({
        payInvoice: vi
          .fn()
          .mockRejectedValue(new Error("Insufficient balance")),
      });
      const adapter = new L402Adapter(wallet, validateUrl);

      await expect(adapter.execute(baseRequest)).rejects.toThrow(
        L402PaymentError,
      );
    });

    it("should throw L402PaymentError when no WWW-Authenticate on 402", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 }));

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);

      await expect(adapter.execute(baseRequest)).rejects.toThrow(
        L402PaymentError,
      );
    });

    it("should report failure when server rejects payment proof", async () => {
      fetchMock.mockResolvedValueOnce(makeL402Response());
      fetchMock.mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401 }),
      );

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);

      const result = await adapter.execute(baseRequest);

      expect(result.success).toBe(false);
      expect(result.responseStatus).toBe(401);
    });

    it("should forward request body on retry", async () => {
      fetchMock.mockResolvedValueOnce(makeL402Response());
      fetchMock.mockResolvedValueOnce(make200Response());

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);
      const body = new TextEncoder().encode('{"query":"test"}');

      await adapter.execute({ ...baseRequest, method: "POST", body });

      const retryCall = fetchMock.mock.calls[1];
      expect(retryCall[1]?.body).toBeDefined();
    });
  });

  describe("name", () => {
    it("should be 'l402'", () => {
      const adapter = new L402Adapter(undefined, validateUrl);
      expect(adapter.name).toBe("l402");
    });
  });

  describe("LSAT backward compatibility", () => {
    const LSAT_MACAROON = "AgEMbG9jYXRpb24gaWQ";
    const LSAT_INVOICE = "lnbc200n1pj_valid";

    function makeLsatResponse(): Response {
      return new Response(null, {
        status: 402,
        headers: {
          "www-authenticate": `LSAT macaroon="${LSAT_MACAROON}", invoice="${LSAT_INVOICE}"`,
        },
      });
    }

    it("should detect LSAT header as L402", async () => {
      fetchMock.mockResolvedValueOnce(makeLsatResponse());
      const adapter = new L402Adapter(undefined, validateUrl);
      const result = await adapter.detect("https://api.example.com/lsat");
      expect(result).toBe(true);
    });

    it("should quote LSAT endpoint correctly", async () => {
      fetchMock.mockResolvedValueOnce(makeLsatResponse());
      const adapter = new L402Adapter(undefined, validateUrl);
      const quote = await adapter.quote("https://api.example.com/lsat");
      expect(quote.protocol).toBe("l402");
      expect(quote.amount.cents).toBe(200n);
    });

    it("should use LSAT prefix in Authorization header when server sent LSAT", async () => {
      fetchMock.mockResolvedValueOnce(makeLsatResponse());
      fetchMock.mockResolvedValueOnce(make200Response('{"ok":true}'));

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);
      await adapter.execute({
        url: "https://api.example.com/lsat",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromSatoshis(200n),
      });

      const retryHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
      expect(retryHeaders.Authorization).toMatch(/^LSAT /);
    });
  });

  describe("quoteFromResponse()", () => {
    it("should extract quote from 402 response with L402 header", async () => {
      const adapter = new L402Adapter(undefined, validateUrl);
      const response = makeL402Response();

      const quote = await adapter.quoteFromResponse(response);

      expect(quote).not.toBeNull();
      expect(quote!.protocol).toBe("l402");
      expect(quote!.network).toBe("lightning");
      expect(quote!.amount.cents).toBe(200n);
      expect(quote!.amount.currency).toBe("SATS");
    });

    it("should extract quote from LSAT header", async () => {
      const adapter = new L402Adapter(undefined, validateUrl);
      const response = new Response(null, {
        status: 402,
        headers: {
          "www-authenticate": `LSAT macaroon="${MOCK_MACAROON}", invoice="${MOCK_INVOICE}"`,
        },
      });

      const quote = await adapter.quoteFromResponse(response);

      expect(quote).not.toBeNull();
      expect(quote!.protocol).toBe("l402");
      expect(quote!.amount.cents).toBe(200n);
    });

    it("should return null for non-402 response", async () => {
      const adapter = new L402Adapter(undefined, validateUrl);
      const response = new Response("ok", { status: 200 });

      const quote = await adapter.quoteFromResponse(response);
      expect(quote).toBeNull();
    });

    it("should return null for 402 without www-authenticate header", async () => {
      const adapter = new L402Adapter(undefined, validateUrl);
      const response = new Response(null, { status: 402 });

      const quote = await adapter.quoteFromResponse(response);
      expect(quote).toBeNull();
    });

    it("should return null for 402 with non-L402 www-authenticate", async () => {
      const adapter = new L402Adapter(undefined, validateUrl);
      const response = new Response(null, {
        status: 402,
        headers: { "www-authenticate": "Bearer realm=test" },
      });

      const quote = await adapter.quoteFromResponse(response);
      expect(quote).toBeNull();
    });

    it("should return null for 402 with malformed L402 header", async () => {
      const adapter = new L402Adapter(undefined, validateUrl);
      const response = new Response(null, {
        status: 402,
        headers: { "www-authenticate": 'L402 macaroon="abc123"' },
      });

      const quote = await adapter.quoteFromResponse(response);
      expect(quote).toBeNull();
    });

    it("should not make any HTTP requests", async () => {
      const adapter = new L402Adapter(undefined, validateUrl);
      const response = makeL402Response();

      await adapter.quoteFromResponse(response);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("invoice-only L402 (MaxSats style)", () => {
    const MOCK_PAYMENT_HASH =
      "ced2697166bcb30f9cedc4fadd456144e279348cbc3ec61f839d4ea6bb0e493d";
    const MOCK_INV_ONLY_INVOICE = "lnbc200n1pj_valid";

    function makeInvoiceOnlyResponse(): Response {
      return new Response(
        JSON.stringify({
          status: "payment_required",
          message: "Pay 5 sats",
          price_sats: 5,
          payment_request: MOCK_INV_ONLY_INVOICE,
          payment_hash: MOCK_PAYMENT_HASH,
        }),
        {
          status: 402,
          headers: {
            "www-authenticate": `L402 invoice="${MOCK_INV_ONLY_INVOICE}", payment_hash="${MOCK_PAYMENT_HASH}"`,
            "content-type": "application/json",
          },
        },
      );
    }

    it("should detect invoice-only L402 header", async () => {
      fetchMock.mockResolvedValueOnce(makeInvoiceOnlyResponse());
      const adapter = new L402Adapter(undefined, validateUrl);

      const result = await adapter.detect("https://maximumsats.com/api/fee-estimate");
      expect(result).toBe(true);
    });

    it("should quote invoice-only endpoint correctly", async () => {
      fetchMock.mockResolvedValueOnce(makeInvoiceOnlyResponse());
      const adapter = new L402Adapter(undefined, validateUrl);

      const quote = await adapter.quote("https://maximumsats.com/api/fee-estimate");
      expect(quote.protocol).toBe("l402");
      expect(quote.network).toBe("lightning");
      expect(quote.amount.cents).toBe(200n); // mock decoder returns 200 sats
    });

    it("should execute invoice-only flow with payment_hash in body", async () => {
      // First fetch returns 402 with invoice-only header
      fetchMock.mockResolvedValueOnce(makeInvoiceOnlyResponse());
      // Second fetch (with payment_hash) returns 200
      fetchMock.mockResolvedValueOnce(make200Response('{"result":"paid"}'));

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);

      const result = await adapter.execute({
        url: "https://maximumsats.com/api/fee-estimate",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new TextEncoder().encode('{"target_blocks":6}'),
        amount: Money.fromSatoshis(5n),
      });

      expect(result.success).toBe(true);
      expect(result.responseStatus).toBe(200);
      expect(wallet.payInvoice).toHaveBeenCalledWith(MOCK_INV_ONLY_INVOICE);

      // Verify payment_hash was injected into retry body
      const retryCall = fetchMock.mock.calls[1];
      const retryBody = retryCall[1]?.body as string;
      const parsed = JSON.parse(retryBody);
      expect(parsed.payment_hash).toBe(MOCK_PAYMENT_HASH);
      expect(parsed.target_blocks).toBe(6); // original body preserved
    });

    it("should create body with payment_hash when original body is empty", async () => {
      fetchMock.mockResolvedValueOnce(makeInvoiceOnlyResponse());
      fetchMock.mockResolvedValueOnce(make200Response('{"ok":true}'));

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);

      await adapter.execute({
        url: "https://maximumsats.com/api/fee-estimate",
        method: "GET",
        headers: {},
        body: undefined,
        amount: Money.fromSatoshis(5n),
      });

      const retryCall = fetchMock.mock.calls[1];
      const retryBody = retryCall[1]?.body as string;
      const parsed = JSON.parse(retryBody);
      expect(parsed.payment_hash).toBe(MOCK_PAYMENT_HASH);
      // Method should be upgraded from GET to POST
      expect(retryCall[1]?.method).toBe("POST");
    });

    it("should set Content-Type to application/json on retry", async () => {
      fetchMock.mockResolvedValueOnce(makeInvoiceOnlyResponse());
      fetchMock.mockResolvedValueOnce(make200Response());

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);

      await adapter.execute({
        url: "https://maximumsats.com/api/fee-estimate",
        method: "POST",
        headers: {},
        body: new TextEncoder().encode('{"prompt":"hello"}'),
        amount: Money.fromSatoshis(5n),
      });

      const retryHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
      expect(retryHeaders["Content-Type"]).toBe("application/json");
    });

    it("should handle non-JSON body gracefully (fall back to payment_hash only)", async () => {
      fetchMock.mockResolvedValueOnce(makeInvoiceOnlyResponse());
      fetchMock.mockResolvedValueOnce(make200Response());

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);

      await adapter.execute({
        url: "https://maximumsats.com/api/fee-estimate",
        method: "POST",
        headers: {},
        body: new TextEncoder().encode("not json at all"),
        amount: Money.fromSatoshis(5n),
      });

      const retryCall = fetchMock.mock.calls[1];
      const retryBody = retryCall[1]?.body as string;
      const parsed = JSON.parse(retryBody);
      expect(parsed.payment_hash).toBe(MOCK_PAYMENT_HASH);
    });

    it("should NOT send Authorization header for invoice-only flow", async () => {
      fetchMock.mockResolvedValueOnce(makeInvoiceOnlyResponse());
      fetchMock.mockResolvedValueOnce(make200Response());

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);

      await adapter.execute({
        url: "https://maximumsats.com/api/fee-estimate",
        method: "POST",
        headers: {},
        body: new TextEncoder().encode('{"prompt":"test"}'),
        amount: Money.fromSatoshis(5n),
      });

      const retryHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
      expect(retryHeaders.Authorization).toBeUndefined();
    });

    it("should extract quote from invoice-only 402 via quoteFromResponse", async () => {
      const adapter = new L402Adapter(undefined, validateUrl);
      const response = makeInvoiceOnlyResponse();

      const quote = await adapter.quoteFromResponse(response);

      expect(quote).not.toBeNull();
      expect(quote!.protocol).toBe("l402");
      expect(quote!.network).toBe("lightning");
      expect(quote!.amount.cents).toBe(200n);
    });
  });

  describe("adversarial responses", () => {
    const baseRequest = {
      url: "https://api.example.com/l402",
      method: "GET",
      headers: {},
      body: undefined,
      amount: Money.fromSatoshis(200n),
    };

    it("should handle 402 with garbage WWW-Authenticate header", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 402,
          headers: { "www-authenticate": "garbage data here" },
        }),
      );
      const adapter = new L402Adapter(undefined, validateUrl);
      const result = await adapter.detect("https://api.example.com/garbage");
      expect(result).toBe(false);
    });

    it("should throw clear error on 402 with truncated L402 header", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 402,
          headers: { "www-authenticate": 'L402 macaroon="abc123"' },
        }),
      );
      const adapter = new L402Adapter(undefined, validateUrl);
      await expect(
        adapter.quote("https://api.example.com/truncated"),
      ).rejects.toThrow(L402QuoteError);
    });

    it("should throw L402PaymentError on server 500 after payment", async () => {
      fetchMock.mockResolvedValueOnce(makeL402Response());
      fetchMock.mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }),
      );

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);
      const result = await adapter.execute(baseRequest);

      expect(result.success).toBe(false);
      expect(result.responseStatus).toBe(500);
    });

    it("should propagate NWC payment error when wallet rejects invoice", async () => {
      fetchMock.mockResolvedValueOnce(makeL402Response());

      const wallet = mockWallet({
        payInvoice: vi.fn().mockRejectedValue(
          new L402PaymentError("NWC payment failed: NWC returned empty preimage"),
        ),
      });
      const adapter = new L402Adapter(wallet, validateUrl);

      await expect(adapter.execute(baseRequest)).rejects.toThrow(
        L402PaymentError,
      );
    });

    it("should handle server returning HTML instead of API response", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("<html><body>Not Found</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
      const adapter = new L402Adapter(undefined, validateUrl);
      const result = await adapter.detect("https://html-site.com");
      expect(result).toBe(false);
    });

    it("should throw on invalid URL", async () => {
      const adapter = new L402Adapter(undefined, validateUrl);
      await expect(adapter.detect("not-a-url")).rejects.toThrow();
    });

    it("should handle 402 with empty body gracefully", async () => {
      fetchMock.mockResolvedValueOnce(makeL402Response());
      fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));

      const wallet = mockWallet();
      const adapter = new L402Adapter(wallet, validateUrl);
      const result = await adapter.execute(baseRequest);

      expect(result.success).toBe(true);
      expect(result.responseBody).toEqual(new Uint8Array(0));
    });
  });
});
