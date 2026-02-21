import type { BoltzPay } from "@boltzpay/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAllTools } from "../src/server.js";
import { createMockSdk, createTestClient } from "./helpers.js";

describe("MCP Server - Tool Registration", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let sdk: BoltzPay;

  beforeEach(async () => {
    sdk = createMockSdk();
    const result = await createTestClient((server) => {
      registerAllTools(server, sdk);
    });
    client = result.client;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should register exactly 7 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);
  });

  it("should prefix all tools with boltzpay_", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^boltzpay_/);
    }
  });

  it("should register all expected tool names", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "boltzpay_budget",
      "boltzpay_check",
      "boltzpay_discover",
      "boltzpay_fetch",
      "boltzpay_history",
      "boltzpay_quote",
      "boltzpay_wallet",
    ]);
  });

  it("should give every tool a non-empty description", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description).toBeTypeOf("string");
      expect((tool.description ?? "").length).toBeGreaterThan(10);
    }
  });

  it("should be able to call boltzpay_budget without error", async () => {
    const result = await client.callTool({
      name: "boltzpay_budget",
      arguments: {},
    });
    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("No budget limits");
  });

  it("should be able to call boltzpay_discover without error", async () => {
    const result = await client.callTool({
      name: "boltzpay_discover",
      arguments: {},
    });
    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    // Mock discover returns [] by default, so we get the "No APIs found" message
    expect(content[0].text).toContain("No APIs found");
  });

  it("should be able to call boltzpay_history without error", async () => {
    const result = await client.callTool({
      name: "boltzpay_history",
      arguments: {},
    });
    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("No payments");
  });
});
