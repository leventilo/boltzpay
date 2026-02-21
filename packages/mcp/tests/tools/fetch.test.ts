import type { BoltzPay } from "@boltzpay/sdk";
import { BoltzPayResponse, BudgetExceededError, Money } from "@boltzpay/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerFetch } from "../../src/tools/fetch.js";
import { createMockSdk, createTestClient } from "../helpers.js";

function createMockResponse(body: string, status = 200): BoltzPayResponse {
  return new BoltzPayResponse({
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    rawBody: new TextEncoder().encode(body),
  });
}

describe("boltzpay_fetch", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let sdk: BoltzPay;

  beforeEach(async () => {
    sdk = createMockSdk();
    const result = await createTestClient((server) => {
      registerFetch(server, sdk);
    });
    client = result.client;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return structured JSON response on successful fetch", async () => {
    vi.mocked(sdk.fetch).mockResolvedValue(
      createMockResponse("Hello, paid world!"),
    );

    const result = await client.callTool({
      name: "boltzpay_fetch",
      arguments: { url: "https://api.example.com/data" },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.status).toBe(200);
    expect(parsed.ok).toBe(true);
    expect(parsed.body).toBe("Hello, paid world!");
    expect(parsed.payment).toBeUndefined();
    expect(sdk.fetch).toHaveBeenCalledWith("https://api.example.com/data", {
      method: undefined,
      headers: undefined,
      body: undefined,
      chain: undefined,
    });
  });

  it("should pass method, headers, and body to SDK", async () => {
    vi.mocked(sdk.fetch).mockResolvedValue(createMockResponse("Created", 201));

    await client.callTool({
      name: "boltzpay_fetch",
      arguments: {
        url: "https://api.example.com/data",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"key":"value"}',
      },
    });

    expect(sdk.fetch).toHaveBeenCalledWith("https://api.example.com/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.any(Uint8Array),
      chain: undefined,
    });
  });

  it("should pass chain parameter to SDK", async () => {
    vi.mocked(sdk.fetch).mockResolvedValue(createMockResponse("OK"));

    await client.callTool({
      name: "boltzpay_fetch",
      arguments: {
        url: "https://api.example.com/data",
        chain: "svm",
      },
    });

    expect(sdk.fetch).toHaveBeenCalledWith("https://api.example.com/data", {
      method: undefined,
      headers: undefined,
      body: undefined,
      chain: "svm",
    });
  });

  it("should return BUDGET_EXCEEDED error when budget exceeded", async () => {
    vi.mocked(sdk.fetch).mockRejectedValue(
      new BudgetExceededError(
        "daily_budget_exceeded",
        Money.fromCents(500n),
        Money.fromCents(100n),
      ),
    );

    const result = await client.callTool({
      name: "boltzpay_fetch",
      arguments: { url: "https://api.example.com/expensive" },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.error).toBe("BUDGET_EXCEEDED");
    expect(parsed.hint).toContain("boltzpay_budget");
  });
});
