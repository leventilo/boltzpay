import type { BoltzPay } from "@boltzpay/sdk";
import { Money } from "@boltzpay/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWallet } from "../../src/tools/wallet.js";
import { createMockSdk, createTestClient } from "../helpers.js";

describe("boltzpay_wallet", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let sdk: BoltzPay;

  beforeEach(async () => {
    sdk = createMockSdk();
    const result = await createTestClient((server) => {
      registerWallet(server, sdk);
    });
    client = result.client;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return wallet status with no credentials", async () => {
    const result = await client.callTool({
      name: "boltzpay_wallet",
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.network).toBe("base");
    expect(parsed.canPay).toBe(false);
    expect(parsed.connection.status).toBe("skipped");
    expect(parsed.credentials.coinbase.configured).toBe(false);
    expect(parsed.accounts.evm).toBeNull();
    expect(parsed.accounts.svm).toBeNull();
  });

  it("should return connected status with balances", async () => {
    vi.mocked(sdk.getWalletStatus).mockResolvedValue({
      network: "base",
      isTestnet: false,
      protocols: ["x402"],
      canPay: true,
      credentials: {
        coinbase: { configured: true, keyHint: "…abcd" },
      },
      connection: { status: "connected", latencyMs: 200 },
      accounts: {
        evm: { address: "0xabc123", balance: Money.fromDollars("5.00") },
        svm: undefined,
      },
      budget: {
        dailySpent: Money.zero(),
        monthlySpent: Money.zero(),
        dailyLimit: undefined,
        monthlyLimit: undefined,
        perTransactionLimit: undefined,
        dailyRemaining: undefined,
        monthlyRemaining: undefined,
      },
    });

    const result = await client.callTool({
      name: "boltzpay_wallet",
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.canPay).toBe(true);
    expect(parsed.connection.status).toBe("connected");
    expect(parsed.connection.latencyMs).toBe(200);
    expect(parsed.accounts.evm.address).toBe("0xabc123");
    expect(parsed.accounts.evm.balance).toBe("$5.00");
    expect(parsed.accounts.svm).toBeNull();
  });

  it("should return budget info when limits configured", async () => {
    vi.mocked(sdk.getWalletStatus).mockResolvedValue({
      network: "base",
      isTestnet: false,
      protocols: ["x402"],
      canPay: false,
      credentials: {
        coinbase: { configured: false, keyHint: undefined },
      },
      connection: {
        status: "skipped",
        reason: "Coinbase credentials not configured",
      },
      accounts: { evm: undefined, svm: undefined },
      budget: {
        dailySpent: Money.fromCents(100n),
        monthlySpent: Money.fromCents(200n),
        dailyLimit: Money.fromCents(1000n),
        monthlyLimit: undefined,
        perTransactionLimit: undefined,
        dailyRemaining: Money.fromCents(900n),
        monthlyRemaining: undefined,
      },
    });

    const result = await client.callTool({
      name: "boltzpay_wallet",
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.budget.configured).toBe(true);
    expect(parsed.budget.daily.limit).toBe("$10.00");
    expect(parsed.budget.daily.remaining).toBe("$9.00");
  });

  it("should return error connection status", async () => {
    vi.mocked(sdk.getWalletStatus).mockResolvedValue({
      network: "base",
      isTestnet: false,
      protocols: ["x402"],
      canPay: true,
      credentials: {
        coinbase: { configured: true, keyHint: "…1234" },
      },
      connection: { status: "error", error: "Invalid API key" },
      accounts: { evm: undefined, svm: undefined },
      budget: {
        dailySpent: Money.zero(),
        monthlySpent: Money.zero(),
        dailyLimit: undefined,
        monthlyLimit: undefined,
        perTransactionLimit: undefined,
        dailyRemaining: undefined,
        monthlyRemaining: undefined,
      },
    });

    const result = await client.callTool({
      name: "boltzpay_wallet",
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.connection.status).toBe("error");
    expect(parsed.connection.error).toBe("Invalid API key");
    expect(parsed.credentials.coinbase.configured).toBe(true);
  });
});
