import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateConfig } from "../../src/config/schema";
import { NetworkError } from "../../src/errors/network-error";
import { fetchRegistryEndpoints } from "../../src/registry/registry-client";

const REGISTRY_URL = "https://status.boltzpay.ai";

const validResponse = {
  data: [
    {
      slug: "coingecko-token-price",
      name: "CoinGecko Token Price",
      url: "https://pro-api.coingecko.com/api/v3/x402/price",
      protocol: "x402",
      score: 85,
      health: "healthy",
      category: "crypto-data",
      isPaid: true,
      badge: "established" as const,
    },
    {
      slug: "satsapi-price",
      name: "SatsAPI Price",
      url: "https://satsapi.dev/v1/price",
      protocol: "l402",
      score: 72,
      health: "healthy",
      category: "crypto-data",
      isPaid: true,
      badge: null,
    },
  ],
  total: 5700,
  offset: 0,
  limit: 200,
  hasMore: true,
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchRegistryEndpoints", () => {
  it("fetches from registryUrl/api/endpoints and returns typed response", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toContain(`${REGISTRY_URL}/api/endpoints`);
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };

    const result = await fetchRegistryEndpoints(REGISTRY_URL);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.slug).toBe("coingecko-token-price");
    expect(result.data[0]!.score).toBe(85);
    expect(result.total).toBe(5700);
    expect(result.hasMore).toBe(true);
  });

  it("passes protocol as 'protocol' query param", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };

    await fetchRegistryEndpoints(REGISTRY_URL, { protocol: "mpp" });

    const params = new URL(capturedUrl).searchParams;
    expect(params.get("protocol")).toBe("mpp");
  });

  it("passes minScore as 'min_score' query param", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };

    await fetchRegistryEndpoints(REGISTRY_URL, { minScore: 70 });

    const params = new URL(capturedUrl).searchParams;
    expect(params.get("min_score")).toBe("70");
  });

  it("passes category as 'category' query param", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };

    await fetchRegistryEndpoints(REGISTRY_URL, { category: "crypto-data" });

    const params = new URL(capturedUrl).searchParams;
    expect(params.get("category")).toBe("crypto-data");
  });

  it("passes query as 'q' query param", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };

    await fetchRegistryEndpoints(REGISTRY_URL, { query: "weather" });

    const params = new URL(capturedUrl).searchParams;
    expect(params.get("q")).toBe("weather");
  });

  it("passes offset as 'offset' query param", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };

    await fetchRegistryEndpoints(REGISTRY_URL, { offset: 100 });

    const params = new URL(capturedUrl).searchParams;
    expect(params.get("offset")).toBe("100");
  });

  it("sets default limit of 200 when not provided", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };

    await fetchRegistryEndpoints(REGISTRY_URL);

    const params = new URL(capturedUrl).searchParams;
    expect(params.get("limit")).toBe("200");
  });

  it("uses provided limit instead of default", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };

    await fetchRegistryEndpoints(REGISTRY_URL, { limit: 50 });

    const params = new URL(capturedUrl).searchParams;
    expect(params.get("limit")).toBe("50");
  });

  it("throws NetworkError when response is not ok (non-2xx)", async () => {
    globalThis.fetch = async () => {
      return new Response("Server Error", { status: 500, statusText: "Internal Server Error" });
    };

    await expect(fetchRegistryEndpoints(REGISTRY_URL)).rejects.toThrow(
      NetworkError,
    );
    await expect(fetchRegistryEndpoints(REGISTRY_URL)).rejects.toThrow(
      /500/,
    );
  });

  it("throws NetworkError when fetch throws (network failure)", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(fetchRegistryEndpoints(REGISTRY_URL)).rejects.toThrow(
      NetworkError,
    );
  });

  it("throws NetworkError on invalid response shape (missing data array)", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };

    await expect(fetchRegistryEndpoints(REGISTRY_URL)).rejects.toThrow(
      NetworkError,
    );
  });

  it("throws NetworkError on invalid response shape (entry missing required fields)", async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          data: [{ slug: "test" }],
          total: 1,
          offset: 0,
          limit: 200,
          hasMore: false,
        }),
        { status: 200 },
      );
    };

    await expect(fetchRegistryEndpoints(REGISTRY_URL)).rejects.toThrow(
      NetworkError,
    );
  });

  it("uses provided signal when options.signal is given", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };

    const controller = new AbortController();
    await fetchRegistryEndpoints(REGISTRY_URL, { signal: controller.signal });

    expect(capturedSignal).toBe(controller.signal);
  });
});

describe("BoltzPayConfigSchema registryUrl", () => {
  it("accepts valid registryUrl", () => {
    const config = validateConfig({
      registryUrl: "https://my-registry.example.com",
      wallets: [],
    });
    expect(config.registryUrl).toBe("https://my-registry.example.com");
  });

  it("accepts config without registryUrl (optional)", () => {
    const config = validateConfig({ wallets: [] });
    expect(config.registryUrl).toBeUndefined();
  });

  it("rejects invalid URL for registryUrl", () => {
    expect(() =>
      validateConfig({ registryUrl: "not-a-url", wallets: [] }),
    ).toThrow();
  });
});
