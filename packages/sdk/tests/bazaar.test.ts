import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearBazaarCache,
  fetchBazaarDirectory,
  getMergedDirectory,
} from "../src/bazaar";
import { API_DIRECTORY } from "../src/directory";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bazaarResponse(items: unknown[], total?: number) {
  return {
    x402Version: 2,
    items,
    pagination: { limit: 200, offset: 0, total: total ?? items.length },
  };
}

function bazaarItem(overrides: Record<string, unknown> = {}) {
  return {
    resource: "https://example.com/api/v1/data",
    type: "http",
    accepts: [
      {
        network: "base",
        maxAmountRequired: 50000, // 0.05 USDC (6 decimals)
        scheme: "exact",
      },
    ],
    metadata: { description: "Test endpoint" },
    lastUpdated: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchBazaarDirectory", () => {
  beforeEach(() => {
    clearBazaarCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return ApiDirectoryEntry[] when API responds successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([
          bazaarItem({ resource: "https://api.example.com/data" }),
        ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const entries = await fetchBazaarDirectory();

    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe("https://api.example.com/data");
    expect(entries[0].protocol).toBe("x402");
    expect(entries[0].category).toBe("bazaar");

    vi.unstubAllGlobals();
  });

  it("should use cached results within TTL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([
          bazaarItem({ resource: "https://cached.com/api" }),
        ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchBazaarDirectory();
    await fetchBazaarDirectory();

    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("should re-fetch after clearBazaarCache()", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => bazaarResponse([bazaarItem()]),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchBazaarDirectory();
    clearBazaarCache();
    await fetchBazaarDirectory();

    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("should return empty array when fetch throws (network error)", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("Network unreachable"));
    vi.stubGlobal("fetch", mockFetch);

    const entries = await fetchBazaarDirectory();

    expect(entries).toEqual([]);

    vi.unstubAllGlobals();
  });

  it("should return empty array when API returns non-200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    });
    vi.stubGlobal("fetch", mockFetch);

    const entries = await fetchBazaarDirectory();

    expect(entries).toEqual([]);

    vi.unstubAllGlobals();
  });

  it("should map BazaarItem fields to ApiDirectoryEntry correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([
          bazaarItem({
            resource: "https://api.example.com/v1/data",
            metadata: { description: "Custom description" },
            accepts: [
              { network: "base", maxAmountRequired: 100000, scheme: "exact" },
            ],
          }),
        ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const entries = await fetchBazaarDirectory();

    expect(entries[0]).toEqual({
      name: "api.example.com — /v1/data",
      url: "https://api.example.com/v1/data",
      protocol: "x402",
      category: "bazaar",
      description: "Custom description",
      pricing: "$0.10",
      chain: "Base",
    });

    vi.unstubAllGlobals();
  });

  it("should derive chain from single network", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([
          bazaarItem({
            accepts: [{ network: "base", maxAmountRequired: 10000 }],
          }),
        ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const entries = await fetchBazaarDirectory();
    expect(entries[0].chain).toBe("Base");

    vi.unstubAllGlobals();
  });

  it("should derive chain from multiple networks (Base + Solana)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([
          bazaarItem({
            accepts: [
              { network: "base", maxAmountRequired: 10000 },
              { network: "solana-mainnet", maxAmountRequired: 10000 },
            ],
          }),
        ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const entries = await fetchBazaarDirectory();
    expect(entries[0].chain).toBe("Base + Solana");

    vi.unstubAllGlobals();
  });

  it("should format pricing from maxAmountRequired (USDC 6 decimals)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([
          // 1000 = $0.001 (less than $0.01 → 4 decimal places)
          bazaarItem({
            resource: "https://cheap.com",
            accepts: [{ network: "base", maxAmountRequired: 1000 }],
          }),
          // 50000 = $0.05 (≥ $0.01 → 2 decimal places)
          bazaarItem({
            resource: "https://moderate.com",
            accepts: [{ network: "base", maxAmountRequired: 50000 }],
          }),
        ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const entries = await fetchBazaarDirectory();
    expect(entries[0].pricing).toBe("$0.0010");
    expect(entries[1].pricing).toBe("$0.05");

    vi.unstubAllGlobals();
  });

  it("should use default description when metadata is missing", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([bazaarItem({ metadata: undefined })]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const entries = await fetchBazaarDirectory();
    expect(entries[0].description).toBe(
      "x402 endpoint via Bazaar Discovery",
    );

    vi.unstubAllGlobals();
  });
});

describe("getMergedDirectory", () => {
  beforeEach(() => {
    clearBazaarCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return only static entries when live is false (default)", async () => {
    const result = await getMergedDirectory();
    expect(result).toBe(API_DIRECTORY);
  });

  it("should return only static entries when live is explicitly false", async () => {
    const result = await getMergedDirectory({ live: false });
    expect(result).toBe(API_DIRECTORY);
  });

  it("should merge Bazaar entries with static when live is true", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([
          bazaarItem({ resource: "https://new-bazaar-endpoint.com/api" }),
        ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await getMergedDirectory({ live: true });

    expect(result.length).toBe(API_DIRECTORY.length + 1);
    expect(result[result.length - 1].url).toBe(
      "https://new-bazaar-endpoint.com/api",
    );

    vi.unstubAllGlobals();
  });

  it("should deduplicate by URL — static entries take priority", async () => {
    // Use a URL that exists in the static directory
    const existingUrl = API_DIRECTORY[0].url;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([
          bazaarItem({
            resource: existingUrl,
            metadata: { description: "Bazaar duplicate" },
          }),
          bazaarItem({ resource: "https://unique-bazaar.com/api" }),
        ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await getMergedDirectory({ live: true });

    // Should have static + 1 unique bazaar entry (not the duplicate)
    expect(result.length).toBe(API_DIRECTORY.length + 1);

    // The entry for existingUrl should be the static one, not Bazaar's
    const matchingEntry = result.find((e) => e.url === existingUrl);
    expect(matchingEntry?.description).not.toBe("Bazaar duplicate");
    expect(matchingEntry?.description).toBe(API_DIRECTORY[0].description);

    vi.unstubAllGlobals();
  });

  it("should return static directory when Bazaar fetch fails", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("API down"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await getMergedDirectory({ live: true });
    expect(result).toBe(API_DIRECTORY);

    vi.unstubAllGlobals();
  });
});
