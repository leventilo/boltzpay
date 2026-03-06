import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  API_DIRECTORY,
  clearDirectoryCache,
  fetchRemoteDirectory,
} from "../../src/directory";

describe("fetchRemoteDirectory", () => {
  beforeEach(() => {
    clearDirectoryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("should fetch and return remote directory entries", async () => {
    const remoteEntries = [
      {
        name: "Remote API",
        url: "https://remote.example.com/api",
        protocol: "x402",
        category: "demo",
        description: "A remote endpoint",
        pricing: "$0.01",
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => remoteEntries,
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchRemoteDirectory();

    expect(result).toEqual(remoteEntries);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("directory.json");
  });

  it("should use cached results within TTL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          name: "Cached",
          url: "https://cached.com",
          protocol: "x402",
          category: "demo",
          description: "Cached",
          pricing: "$0.01",
        },
      ],
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchRemoteDirectory();
    await fetchRemoteDirectory();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should re-fetch after clearDirectoryCache()", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchRemoteDirectory();
    clearDirectoryCache();
    await fetchRemoteDirectory();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should fall back to API_DIRECTORY on network error", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("Network unreachable"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchRemoteDirectory();

    expect(result).toBe(API_DIRECTORY);
  });

  it("should fall back to API_DIRECTORY on non-200 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchRemoteDirectory();

    expect(result).toBe(API_DIRECTORY);
  });

  it("should fall back to API_DIRECTORY on abort/timeout", async () => {
    const mockFetch = vi.fn().mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchRemoteDirectory();

    expect(result).toBe(API_DIRECTORY);
  });
});
