import type { BoltzPay } from "@boltzpay/sdk";
import { Money, ProtocolError } from "@boltzpay/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerQuote } from "../../src/tools/quote.js";
import { createMockSdk, createTestClient } from "../helpers.js";

describe("boltzpay_quote", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let sdk: BoltzPay;

  beforeEach(async () => {
    sdk = createMockSdk();
    const result = await createTestClient((server) => {
      registerQuote(server, sdk);
    });
    client = result.client;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return quote details with protocol, amount, currency, and network", async () => {
    vi.mocked(sdk.quote).mockResolvedValue({
      amount: Money.fromCents(500n),
      protocol: "x402",
      network: "base",
    });

    const result = await client.callTool({
      name: "boltzpay_quote",
      arguments: { url: "https://api.example.com/paid" },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.protocol).toBe("x402");
    expect(parsed.amount).toBe("$5.00");
    expect(parsed.currency).toBe("USD");
    expect(parsed.network).toBe("base");
  });

  it("should return free endpoint message when protocol detection fails", async () => {
    vi.mocked(sdk.quote).mockRejectedValue(
      new ProtocolError(
        "protocol_detection_failed",
        "No payment protocol detected",
      ),
    );

    const result = await client.callTool({
      name: "boltzpay_quote",
      arguments: { url: "https://free.example.com" },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("free");
  });

  it("should include multi-chain alternatives in quote response", async () => {
    vi.mocked(sdk.quote).mockResolvedValue({
      amount: Money.fromCents(5n),
      protocol: "x402",
      network: "eip155:8453",
      allAccepts: [
        {
          namespace: "evm",
          network: "eip155:8453",
          amount: 5n,
          payTo: "0xabc",
          asset: "USDC",
          scheme: "exact",
        },
        {
          namespace: "svm",
          network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          amount: 5n,
          payTo: "5xyz",
          asset: "USDC",
          scheme: "exact",
        },
      ],
    });

    const result = await client.callTool({
      name: "boltzpay_quote",
      arguments: { url: "https://multi.example.com" },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    // Primary quote fields
    expect(parsed.protocol).toBe("x402");
    expect(parsed.amount).toBe("$0.05");
    expect(parsed.network).toBe("eip155:8453");

    // Alternatives = allAccepts minus primary (first entry)
    expect(parsed.alternatives).toHaveLength(1);
    expect(parsed.alternatives[0].chain).toBe("Solana");
    expect(parsed.alternatives[0].network).toBe(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    );
    expect(parsed.alternatives[0].amount).toBe("$0.05");
  });

  it("should not include alternatives when only one accept option exists", async () => {
    vi.mocked(sdk.quote).mockResolvedValue({
      amount: Money.fromCents(100n),
      protocol: "x402",
      network: "eip155:8453",
      allAccepts: [
        {
          namespace: "evm",
          network: "eip155:8453",
          amount: 100n,
          payTo: "0xabc",
          asset: "USDC",
          scheme: "exact",
        },
      ],
    });

    const result = await client.callTool({
      name: "boltzpay_quote",
      arguments: { url: "https://single.example.com" },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.protocol).toBe("x402");
    expect(parsed.amount).toBe("$1.00");
    expect(parsed.alternatives).toBeUndefined();
  });

  it("should not include alternatives when allAccepts is undefined", async () => {
    vi.mocked(sdk.quote).mockResolvedValue({
      amount: Money.fromCents(500n),
      protocol: "x402",
      network: "base",
    });

    const result = await client.callTool({
      name: "boltzpay_quote",
      arguments: { url: "https://api.example.com/no-accepts" },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.protocol).toBe("x402");
    expect(parsed.amount).toBe("$5.00");
    expect(parsed.alternatives).toBeUndefined();
  });

  it("should return error for non-detection protocol errors", async () => {
    vi.mocked(sdk.quote).mockRejectedValue(
      new ProtocolError("payment_failed", "Server error"),
    );

    const result = await client.callTool({
      name: "boltzpay_quote",
      arguments: { url: "https://broken.example.com" },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.error).toBe("PROTOCOL_ERROR");
  });
});
