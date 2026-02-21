import type { DiscoveredEntry } from "@boltzpay/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerDiscover } from "../../src/tools/discover.js";
import { createMockSdk, createTestClient } from "../helpers.js";

describe("boltzpay_discover", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  const sdk = createMockSdk();

  const liveEntry: DiscoveredEntry = {
    name: "Invy",
    url: "https://invy.bot/api",
    protocol: "x402",
    category: "crypto-data",
    description: "Token holdings",
    pricing: "$0.05",
    live: {
      status: "live",
      livePrice: "$0.05",
      protocol: "x402",
      network: "eip155:8453",
    },
  };

  const freeEntry: DiscoveredEntry = {
    name: "Free",
    url: "https://free.example.com",
    protocol: "x402",
    category: "demo",
    description: "Free endpoint",
    pricing: "$0.00",
    live: { status: "free" },
  };

  const offlineEntry: DiscoveredEntry = {
    name: "Offline",
    url: "https://offline.example.com",
    protocol: "x402",
    category: "utilities",
    description: "Offline",
    pricing: "$0.01",
    live: { status: "offline", reason: "Timeout" },
  };

  beforeEach(async () => {
    const result = await createTestClient((server) => {
      registerDiscover(server, sdk);
    });
    client = result.client;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
    sdk.discover.mockReset();
  });

  it("should return enriched entries with live status", async () => {
    sdk.discover.mockResolvedValue([liveEntry, offlineEntry, freeEntry]);

    const result = await client.callTool({
      name: "boltzpay_discover",
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toHaveLength(3);

    expect(parsed[0].status).toBe("live");
    expect(parsed[0].price).toBe("$0.05");
    expect(parsed[0].isPriceVerified).toBe(true);
    expect(parsed[0].detectedProtocol).toBe("x402");

    expect(parsed[1].status).toBe("offline");
    expect(parsed[1].isPriceVerified).toBe(false);

    expect(parsed[2].status).toBe("free");
    expect(parsed[2].price).toBe("Free");
    expect(parsed[2].isPriceVerified).toBe(true);
  });

  it("should pass category to sdk.discover()", async () => {
    sdk.discover.mockResolvedValue([liveEntry]);

    await client.callTool({
      name: "boltzpay_discover",
      arguments: { category: "crypto-data" },
    });

    expect(sdk.discover).toHaveBeenCalledWith({
      category: "crypto-data",
      enableLiveDiscovery: true,
    });
  });

  it("should return formatted error when sdk.discover() throws", async () => {
    sdk.discover.mockRejectedValue(new Error("Network timeout"));

    const result = await client.callTool({
      name: "boltzpay_discover",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.error).toBe("INTERNAL_ERROR");
    expect(parsed.message).toContain("Network timeout");
  });

  it("should return message for empty results", async () => {
    sdk.discover.mockResolvedValue([]);

    const result = await client.callTool({
      name: "boltzpay_discover",
      arguments: { category: "nonexistent" },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("No APIs found");
    expect(content[0].text).toContain("Available categories");
  });
});
