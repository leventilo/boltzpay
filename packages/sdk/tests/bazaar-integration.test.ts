import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiDirectoryEntry } from "../src/directory";
import { API_DIRECTORY, filterEntries } from "../src/directory";
import { clearBazaarCache, getMergedDirectory } from "../src/bazaar";

function bazaarResponse(items: unknown[], total?: number) {
  return {
    x402Version: 2,
    items,
    pagination: { limit: 200, offset: 0, total: total ?? items.length },
  };
}

function bazaarItem(overrides: Record<string, unknown> = {}) {
  return {
    resource: "https://bazaar-unique.example.com/api",
    type: "http",
    accepts: [
      {
        network: "base",
        maxAmountRequired: 50000,
        scheme: "exact",
      },
    ],
    metadata: { description: "Bazaar endpoint" },
    ...overrides,
  };
}

describe("filterEntries", () => {
  const entries: readonly ApiDirectoryEntry[] = [
    {
      name: "Alpha",
      url: "https://alpha.example.com",
      protocol: "x402",
      category: "crypto-data",
      description: "Alpha service",
      pricing: "$0.05",
    },
    {
      name: "Beta",
      url: "https://beta.example.com",
      protocol: "l402",
      category: "utilities",
      description: "Beta service",
      pricing: "100 sats",
    },
    {
      name: "Gamma",
      url: "https://gamma.example.com",
      protocol: "x402",
      category: "Crypto-Data",
      description: "Gamma service (uppercase category)",
      pricing: "$0.10",
    },
  ];

  it("returns all entries when no category is provided", () => {
    const result = filterEntries(entries);

    expect(result).toBe(entries);
  });

  it("filters entries by category (case-insensitive)", () => {
    const result = filterEntries(entries, "Utilities");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Beta");
  });

  it("returns empty array for a nonexistent category", () => {
    const result = filterEntries(entries, "nonexistent-category");

    expect(result).toHaveLength(0);
  });
});

describe("getMergedDirectory integration", () => {
  beforeEach(() => {
    clearBazaarCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns static directory only when live is false", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await getMergedDirectory({ live: false });

    expect(result).toBe(API_DIRECTORY);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns merged entries when live is true", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([
          bazaarItem({ resource: "https://live-bazaar.example.com/api" }),
        ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await getMergedDirectory({ live: true });

    expect(result.length).toBe(API_DIRECTORY.length + 1);

    const bazaarEntry = result.find(
      (e) => e.url === "https://live-bazaar.example.com/api",
    );
    expect(bazaarEntry).toBeDefined();
    expect(bazaarEntry?.protocol).toBe("x402");
    expect(bazaarEntry?.category).toBe("bazaar");
  });

  it("deduplicates by URL — static entries take priority over bazaar entries", async () => {
    const existingStaticUrl = API_DIRECTORY[0].url;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        bazaarResponse([
          bazaarItem({
            resource: existingStaticUrl,
            metadata: { description: "Bazaar duplicate — should be ignored" },
          }),
          bazaarItem({
            resource: "https://unique-only-in-bazaar.example.com/api",
          }),
        ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await getMergedDirectory({ live: true });

    expect(result.length).toBe(API_DIRECTORY.length + 1);

    const entry = result.find((e) => e.url === existingStaticUrl);
    expect(entry?.description).toBe(API_DIRECTORY[0].description);
    expect(entry?.description).not.toBe(
      "Bazaar duplicate — should be ignored",
    );
  });
});
