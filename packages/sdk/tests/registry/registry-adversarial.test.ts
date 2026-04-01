import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NetworkError } from "../../src/errors/network-error";
import { fetchRegistryEndpoints } from "../../src/registry/registry-client";

const REGISTRY_URL = "https://status.boltzpay.ai";

const validEndpoint = {
  slug: "test-endpoint",
  name: "Test Endpoint",
  url: "https://api.example.com/v1/test",
  protocol: "x402",
  score: 85,
  health: "healthy",
  category: "crypto-data",
  isPaid: true,
  badge: null,
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Registry adversarial: HTML body on 200", () => {
  it("throws NetworkError with registry_invalid_response when body is HTML", async () => {
    globalThis.fetch = async () => {
      return new Response(
        "<html><body><h1>Service Unavailable</h1></body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    };

    const err = await fetchRegistryEndpoints(REGISTRY_URL).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).code).toBe("registry_invalid_response");
    expect((err as NetworkError).message).toContain("invalid JSON");
  });
});

describe("Registry adversarial: empty data array", () => {
  it("returns empty array cleanly when data is []", async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ data: [], total: 0, offset: 0, limit: 200, hasMore: false }),
        { status: 200 },
      );
    };

    const result = await fetchRegistryEndpoints(REGISTRY_URL);

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});

describe("Registry adversarial: XSS payloads in fields", () => {
  it("passes through XSS payloads without sanitization (consumer responsibility)", async () => {
    const xssName = '<script>alert("xss")</script>';
    const xssUrl = 'https://evil.com/"><img src=x onerror=alert(1)>';

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              ...validEndpoint,
              name: xssName,
              url: xssUrl,
            },
          ],
          total: 1,
          offset: 0,
          limit: 200,
          hasMore: false,
        }),
        { status: 200 },
      );
    };

    const result = await fetchRegistryEndpoints(REGISTRY_URL);

    expect(result.data[0]!.name).toBe(xssName);
    expect(result.data[0]!.url).toBe(xssUrl);
  });
});

describe("Registry adversarial: truncated JSON", () => {
  it("throws NetworkError with registry_invalid_response on partial JSON", async () => {
    globalThis.fetch = async () => {
      return new Response('{"data": [{"slug": "test", "name": "Tes', {
        status: 200,
      });
    };

    const err = await fetchRegistryEndpoints(REGISTRY_URL).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).code).toBe("registry_invalid_response");
    expect((err as NetworkError).message).toContain("invalid JSON");
  });
});

describe("Registry adversarial: 429 rate limited", () => {
  it("throws NetworkError with actionable message including status code", async () => {
    globalThis.fetch = async () => {
      return new Response("Too Many Requests", {
        status: 429,
        statusText: "Too Many Requests",
      });
    };

    const err = await fetchRegistryEndpoints(REGISTRY_URL).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).code).toBe("registry_unavailable");
    expect((err as NetworkError).message).toContain("429");
  });
});

describe("Registry adversarial: timeout via AbortSignal", () => {
  it("throws NetworkError when fetch is aborted by signal timeout", async () => {
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    };

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    const err = await fetchRegistryEndpoints(REGISTRY_URL, {
      signal: controller.signal,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).code).toBe("registry_unavailable");
    expect((err as NetworkError).message).toContain("aborted");
  });

  it("uses default 10s AbortSignal.timeout when no signal is provided", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response(
        JSON.stringify({
          data: [],
          total: 0,
          offset: 0,
          limit: 200,
          hasMore: false,
        }),
        { status: 200 },
      );
    };

    await fetchRegistryEndpoints(REGISTRY_URL);

    expect(capturedSignal).toBeDefined();
  });
});

describe("Registry adversarial: response shape edge cases", () => {
  it("throws on response that is a JSON array instead of object", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify([validEndpoint]), { status: 200 });
    };

    const err = await fetchRegistryEndpoints(REGISTRY_URL).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).code).toBe("registry_invalid_response");
  });

  it("throws on response that is a JSON null", async () => {
    globalThis.fetch = async () => {
      return new Response("null", { status: 200 });
    };

    const err = await fetchRegistryEndpoints(REGISTRY_URL).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).code).toBe("registry_invalid_response");
  });

  it("throws on response with data containing entries missing isPaid field", async () => {
    globalThis.fetch = async () => {
      const incomplete = { ...validEndpoint };
      const { isPaid, ...rest } = incomplete;
      return new Response(
        JSON.stringify({ data: [rest], total: 1, offset: 0, limit: 200, hasMore: false }),
        { status: 200 },
      );
    };

    const err = await fetchRegistryEndpoints(REGISTRY_URL).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).code).toBe("registry_invalid_response");
    expect((err as NetworkError).message).toContain("invalid endpoint entry");
  });

  it("defaults total to data.length when not provided", async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ data: [validEndpoint] }),
        { status: 200 },
      );
    };

    const result = await fetchRegistryEndpoints(REGISTRY_URL);

    expect(result.total).toBe(1);
    expect(result.offset).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});
