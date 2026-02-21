import type { BoltzPay } from "@boltzpay/sdk";
import { Money, ProtocolError } from "@boltzpay/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCheck } from "../../src/tools/check.js";
import { createMockSdk, createTestClient } from "../helpers.js";

describe("boltzpay_check", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let sdk: BoltzPay;

  beforeEach(async () => {
    sdk = createMockSdk();
    const result = await createTestClient((server) => {
      registerCheck(server, sdk);
    });
    client = result.client;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return isPaid: true when quote succeeds", async () => {
    vi.mocked(sdk.quote).mockResolvedValue({
      amount: Money.fromCents(100n),
      protocol: "x402",
      network: "base",
    });

    const result = await client.callTool({
      name: "boltzpay_check",
      arguments: { url: "https://paid.example.com" },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.isPaid).toBe(true);
    expect(parsed.protocol).toBe("x402");
    expect(parsed.amount).toBe("$1.00");
  });

  it("should return isPaid: false when protocol detection fails", async () => {
    vi.mocked(sdk.quote).mockRejectedValue(
      new ProtocolError(
        "protocol_detection_failed",
        "No payment protocol detected",
      ),
    );

    const result = await client.callTool({
      name: "boltzpay_check",
      arguments: { url: "https://free.example.com" },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.isPaid).toBe(false);
  });

  it("should return error for non-detection failures", async () => {
    vi.mocked(sdk.quote).mockRejectedValue(
      new ProtocolError("payment_failed", "Network error"),
    );

    const result = await client.callTool({
      name: "boltzpay_check",
      arguments: { url: "https://broken.example.com" },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.error).toBe("PROTOCOL_ERROR");
  });

  it("should return options array when allAccepts has multiple chains", async () => {
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
      name: "boltzpay_check",
      arguments: { url: "https://multi.example.com" },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.options).toHaveLength(2);
    expect(parsed.options[0].chain).toBe("Base");
    expect(parsed.options[1].chain).toBe("Solana");
  });
});
