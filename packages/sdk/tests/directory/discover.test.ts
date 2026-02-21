import { describe, expect, it, vi } from "vitest";

vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {},
}));

vi.mock("@boltzpay/protocols", () => {
  class MockCdpWalletManager {
    constructor() {}
    getAddresses() {
      return {};
    }
  }
  class MockProtocolRouter {
    probeAll() {
      return Promise.reject(new Error("Not implemented in test"));
    }
    execute() {
      return Promise.reject(new Error("Not implemented in test"));
    }
  }
  class MockX402Adapter {
    name = "x402";
    constructor() {}
  }
  class MockL402Adapter {
    name = "l402";
    constructor() {}
  }
  class MockNwcWalletManager {
    constructor() {}
  }
  class MockAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: MockX402Adapter,
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
  };
});

import { Money } from "@boltzpay/core";
import type { DiscoveredEntry } from "../../src/directory";
import {
  API_DIRECTORY,
  classifyProbeError,
  filterDirectory,
  sortDiscoveredEntries,
  toDiscoverJson,
  withTimeout,
} from "../../src/directory";
import { NetworkError } from "../../src/errors/network-error";
import { ProtocolError } from "../../src/errors/protocol-error";

describe("filterDirectory", () => {
  it("should return all entries without category", () => {
    const result = filterDirectory();
    expect(result).toBe(API_DIRECTORY);
  });

  it("should filter by category (case-insensitive)", () => {
    const result = filterDirectory("crypto-data");
    expect(result.length).toBeGreaterThan(0);
    for (const entry of result) {
      expect(entry.category).toBe("crypto-data");
    }
  });

  it("should return empty array for unknown category", () => {
    const result = filterDirectory("nonexistent");
    expect(result).toEqual([]);
  });
});

describe("classifyProbeError", () => {
  it("should classify ProtocolError protocol_detection_failed as free", () => {
    const err = new ProtocolError("protocol_detection_failed", "No protocol");
    expect(classifyProbeError(err)).toEqual({ status: "free" });
  });

  it("should classify ProtocolError payment_failed as error", () => {
    const err = new ProtocolError("payment_failed", "Payment failed");
    expect(classifyProbeError(err)).toEqual({
      status: "error",
      reason: "Payment failed",
    });
  });

  it("should classify NetworkError as offline", () => {
    const err = new NetworkError("endpoint_unreachable", "Connection refused");
    expect(classifyProbeError(err)).toEqual({
      status: "offline",
      reason: "Connection refused",
    });
  });

  it("should classify TimeoutError as offline", () => {
    const err = new DOMException("Timeout", "TimeoutError");
    expect(classifyProbeError(err)).toEqual({
      status: "offline",
      reason: "Timeout",
    });
  });

  it("should classify AbortError as offline", () => {
    const err = new DOMException("Aborted", "AbortError");
    expect(classifyProbeError(err)).toEqual({
      status: "offline",
      reason: "Aborted",
    });
  });

  it("should classify unknown error as error", () => {
    const err = new Error("Something weird");
    expect(classifyProbeError(err)).toEqual({
      status: "error",
      reason: "Something weird",
    });
  });

  it("should classify non-Error as error with string representation", () => {
    expect(classifyProbeError("string error")).toEqual({
      status: "error",
      reason: "string error",
    });
  });
});

describe("sortDiscoveredEntries", () => {
  const base = {
    name: "Test",
    url: "https://test.com",
    protocol: "x402",
    category: "test",
    description: "Test",
    pricing: "$0.01",
  };

  it("should sort live > offline > error > free", () => {
    const entries: DiscoveredEntry[] = [
      { ...base, name: "Free", live: { status: "free" } },
      {
        ...base,
        name: "Error",
        live: { status: "error", reason: "fail" },
      },
      {
        ...base,
        name: "Live",
        live: {
          status: "live",
          livePrice: "$0.05",
          protocol: "x402",
          network: "base",
        },
      },
      {
        ...base,
        name: "Offline",
        live: { status: "offline", reason: "timeout" },
      },
    ];

    const sorted = sortDiscoveredEntries(entries);
    expect(sorted.map((e) => e.name)).toEqual([
      "Live",
      "Offline",
      "Error",
      "Free",
    ]);
  });

  it("should not mutate the input array", () => {
    const entries: DiscoveredEntry[] = [
      { ...base, live: { status: "free" } },
      {
        ...base,
        live: {
          status: "live",
          livePrice: "$0.05",
          protocol: "x402",
          network: undefined,
        },
      },
    ];
    const sorted = sortDiscoveredEntries(entries);
    expect(sorted).not.toBe(entries);
    expect(entries[0].live.status).toBe("free");
  });
});

describe("toDiscoverJson", () => {
  const base = {
    name: "Test",
    url: "https://test.com",
    protocol: "x402",
    category: "test",
    description: "Test",
    pricing: "$0.01",
  };

  it("should serialize live entry with isPriceVerified true", () => {
    const entry: DiscoveredEntry = {
      ...base,
      live: {
        status: "live",
        livePrice: "$0.05",
        protocol: "x402",
        network: "eip155:8453",
      },
    };
    const json = toDiscoverJson(entry);
    expect(json.status).toBe("live");
    expect(json.price).toBe("$0.05");
    expect(json.isPriceVerified).toBe(true);
    expect(json.detectedProtocol).toBe("x402");
    expect(json.network).toBe("eip155:8453");
    expect(json.reason).toBeUndefined();
  });

  it("should serialize free entry with isPriceVerified true", () => {
    const entry: DiscoveredEntry = { ...base, live: { status: "free" } };
    const json = toDiscoverJson(entry);
    expect(json.status).toBe("free");
    expect(json.price).toBe("Free");
    expect(json.isPriceVerified).toBe(true);
    expect(json.detectedProtocol).toBeUndefined();
  });

  it("should serialize offline entry with reason and isPriceVerified false", () => {
    const entry: DiscoveredEntry = {
      ...base,
      live: { status: "offline", reason: "Timeout" },
    };
    const json = toDiscoverJson(entry);
    expect(json.status).toBe("offline");
    expect(json.price).toBe("$0.01");
    expect(json.isPriceVerified).toBe(false);
    expect(json.reason).toBe("Timeout");
  });

  it("should serialize error entry with reason and isPriceVerified false", () => {
    const entry: DiscoveredEntry = {
      ...base,
      live: { status: "error", reason: "Unknown failure" },
    };
    const json = toDiscoverJson(entry);
    expect(json.status).toBe("error");
    expect(json.price).toBe("$0.01");
    expect(json.isPriceVerified).toBe(false);
    expect(json.reason).toBe("Unknown failure");
  });

  it("should set network to undefined when live entry has undefined network", () => {
    const entry: DiscoveredEntry = {
      ...base,
      live: {
        status: "live",
        livePrice: "$0.05",
        protocol: "x402",
        network: undefined,
      },
    };
    const json = toDiscoverJson(entry);
    expect(json.network).toBeUndefined();
  });
});

describe("withTimeout", () => {
  it("should resolve when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it("should reject with TimeoutError when timeout expires", async () => {
    const slow = new Promise<never>(() => {});
    await expect(withTimeout(slow, 10)).rejects.toThrow("Timeout");
    try {
      await withTimeout(slow, 10);
    } catch (err) {
      expect((err as Error).name).toBe("TimeoutError");
    }
  });

  it("should reject with original error when promise rejects before timeout", async () => {
    const err = new Error("original");
    await expect(withTimeout(Promise.reject(err), 1000)).rejects.toThrow(
      "original",
    );
  });

  it("should reject with AbortError when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withTimeout(Promise.resolve(42), 1000, controller.signal),
    ).rejects.toThrow();
    try {
      await withTimeout(Promise.resolve(42), 1000, controller.signal);
    } catch (err) {
      expect((err as Error).name).toBe("AbortError");
    }
  });

  it("should reject with AbortError when signal is aborted during wait", async () => {
    const controller = new AbortController();
    const slow = new Promise<never>(() => {});
    const promise = withTimeout(slow, 5000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow();
    try {
      const controller2 = new AbortController();
      const promise2 = withTimeout(
        new Promise<never>(() => {}),
        5000,
        controller2.signal,
      );
      controller2.abort();
      await promise2;
    } catch (err) {
      expect((err as Error).name).toBe("AbortError");
    }
  });
});

describe("BoltzPay.discover()", () => {
  it("should probe entries and return enriched results", async () => {
    // Dynamic import to avoid circular issues; use real BoltzPay with mocked router
    const { BoltzPay } = await import("../../src/boltzpay");

    const sdk = new BoltzPay({ network: "base" });
    const quoteSpy = vi.spyOn(sdk, "quote");

    quoteSpy.mockResolvedValueOnce({
      amount: Money.fromDollars("0.05"),
      protocol: "x402",
      network: "eip155:8453",
    });
    quoteSpy.mockRejectedValueOnce(
      new ProtocolError("protocol_detection_failed", "No protocol"),
    );
    quoteSpy.mockRejectedValueOnce(
      new DOMException("Timeout", "TimeoutError"),
    );
    quoteSpy.mockRejectedValueOnce(new Error("Unexpected"));

    // Patch getMergedDirectory to control inputs
    const bazaarModule = await import("../../src/bazaar");
    const mergedSpy = vi.spyOn(bazaarModule, "getMergedDirectory");
    const fakeEntries = [
      {
        name: "A",
        url: "https://a.com",
        protocol: "x402",
        category: "test",
        description: "A",
        pricing: "$0.05",
      },
      {
        name: "B",
        url: "https://b.com",
        protocol: "x402",
        category: "test",
        description: "B",
        pricing: "$0.01",
      },
      {
        name: "C",
        url: "https://c.com",
        protocol: "x402",
        category: "test",
        description: "C",
        pricing: "$0.10",
      },
      {
        name: "D",
        url: "https://d.com",
        protocol: "x402",
        category: "test",
        description: "D",
        pricing: "$0.02",
      },
    ];
    mergedSpy.mockResolvedValue(fakeEntries);

    const results = await sdk.discover();

    expect(results).toHaveLength(4);
    // Sorted: live, offline (timeout), error, free
    expect(results[0].live.status).toBe("live");
    expect(results[0].name).toBe("A");
    if (results[0].live.status === "live") {
      expect(results[0].live.livePrice).toBe("$0.05");
      expect(results[0].live.protocol).toBe("x402");
    }

    expect(results[1].live.status).toBe("offline");
    expect(results[1].name).toBe("C");

    expect(results[2].live.status).toBe("error");
    expect(results[2].name).toBe("D");

    expect(results[3].live.status).toBe("free");
    expect(results[3].name).toBe("B");

    mergedSpy.mockRestore();
    quoteSpy.mockRestore();
  });
});
