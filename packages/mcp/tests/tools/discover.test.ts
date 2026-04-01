import type { DiscoveredEntry } from "@boltzpay/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerDiscover } from "../../src/tools/discover.js";
import { createMockSdk, createTestClient } from "../helpers.js";

describe("boltzpay_discover", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  const sdk = createMockSdk();

  const healthyEntry: DiscoveredEntry = {
    slug: "test-api",
    name: "Test API",
    url: "https://api.test.com/v1/data",
    protocol: "x402",
    score: 85,
    health: "healthy",
    category: "crypto-data",
    isPaid: true,
    badge: "established",
  };

  const mppEntry: DiscoveredEntry = {
    slug: "mpp-api",
    name: "MPP Weather",
    url: "https://weather.mpp.com/api",
    protocol: "mpp",
    score: 72,
    health: "healthy",
    category: "weather",
    isPaid: true,
    badge: "new",
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

  it("passes protocol param to sdk.discover", async () => {
    sdk.discover.mockResolvedValue([healthyEntry]);

    await client.callTool({
      name: "boltzpay_discover",
      arguments: { protocol: "x402" },
    });

    expect(sdk.discover).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "x402" }),
    );
  });

  it("passes minScore param to sdk.discover", async () => {
    sdk.discover.mockResolvedValue([healthyEntry]);

    await client.callTool({
      name: "boltzpay_discover",
      arguments: { minScore: 70 },
    });

    expect(sdk.discover).toHaveBeenCalledWith(
      expect.objectContaining({ minScore: 70 }),
    );
  });

  it("passes query param to sdk.discover", async () => {
    sdk.discover.mockResolvedValue([healthyEntry]);

    await client.callTool({
      name: "boltzpay_discover",
      arguments: { query: "weather" },
    });

    expect(sdk.discover).toHaveBeenCalledWith(
      expect.objectContaining({ query: "weather" }),
    );
  });

  it("returns entries as JSON text content", async () => {
    sdk.discover.mockResolvedValue([healthyEntry, mppEntry]);

    const result = await client.callTool({
      name: "boltzpay_discover",
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    expect(Array.isArray(result.content)).toBe(true);
    const content = result.content;
    if (!Array.isArray(content)) throw new Error("expected array content");
    const first = content[0];
    if (!first || !("text" in first)) throw new Error("expected text content");
    const parsed = JSON.parse(first.text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].slug).toBe("test-api");
    expect(parsed[0].score).toBe(85);
    expect(parsed[0].health).toBe("healthy");
    expect(parsed[0].protocol).toBe("x402");
    expect(parsed[1].slug).toBe("mpp-api");
    expect(parsed[1].protocol).toBe("mpp");
  });

  it("returns message for empty results", async () => {
    sdk.discover.mockResolvedValue([]);

    const result = await client.callTool({
      name: "boltzpay_discover",
      arguments: { category: "nonexistent" },
    });

    expect(result.isError).toBeUndefined();
    expect(Array.isArray(result.content)).toBe(true);
    const content = result.content;
    if (!Array.isArray(content)) throw new Error("expected array content");
    const first = content[0];
    if (!first || !("text" in first)) throw new Error("expected text content");
    expect(first.text).toContain("No APIs found");
  });

  it("returns formatted error when sdk.discover() throws", async () => {
    sdk.discover.mockRejectedValue(new Error("Network timeout"));

    const result = await client.callTool({
      name: "boltzpay_discover",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    const content = result.content;
    if (!Array.isArray(content)) throw new Error("expected array content");
    const first = content[0];
    if (!first || !("text" in first)) throw new Error("expected text content");
    const parsed = JSON.parse(first.text);
    expect(parsed.error).toBe("INTERNAL_ERROR");
    expect(parsed.message).toContain("Network timeout");
  });
});
