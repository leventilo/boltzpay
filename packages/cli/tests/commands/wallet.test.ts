import { Money } from "@boltzpay/sdk";
import type { WalletStatus } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerWalletCommand } from "../../src/commands/wallet.js";

const mockGetWalletStatus = vi.fn<() => Promise<WalletStatus>>();

vi.mock("../../src/config.js", () => ({
  createSdkFromEnv: () => ({
    getWalletStatus: mockGetWalletStatus,
    close: vi.fn(),
  }),
}));

function noop(): void {}

vi.spyOn(process, "exit").mockImplementation(noop as () => never);

function createProgram(): Command {
  const program = new Command();
  program.option("--json", "JSON output", false);
  registerWalletCommand(program);
  return program;
}

function makeStatus(overrides: Partial<WalletStatus> = {}): WalletStatus {
  return {
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
      dailySpent: Money.zero(),
      monthlySpent: Money.zero(),
      dailyLimit: undefined,
      monthlyLimit: undefined,
      perTransactionLimit: undefined,
      dailyRemaining: undefined,
      monthlyRemaining: undefined,
    },
    ...overrides,
  };
}

describe("wallet command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mockGetWalletStatus.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should show wallet status header", async () => {
    mockGetWalletStatus.mockResolvedValue(makeStatus());
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "wallet"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Wallet Status");
  });

  it("should show not configured when no credentials", async () => {
    mockGetWalletStatus.mockResolvedValue(makeStatus());
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "wallet"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Not configured");
    expect(output).toContain("Skipped");
    expect(output).toContain("COINBASE_API_KEY_ID");
  });

  it("should show connected status with balance", async () => {
    mockGetWalletStatus.mockResolvedValue(
      makeStatus({
        canPay: true,
        credentials: {
          coinbase: { configured: true, keyHint: "…abcd" },
        },
        connection: { status: "connected", latencyMs: 150 },
        accounts: {
          evm: {
            address: "0xabc123",
            balance: Money.fromDollars("5.00"),
          },
          svm: undefined,
        },
      }),
    );
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "wallet"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Connected");
    expect(output).toContain("150ms");
    expect(output).toContain("0xabc123");
    expect(output).toContain("$5.00");
  });

  it("should show connection error", async () => {
    mockGetWalletStatus.mockResolvedValue(
      makeStatus({
        canPay: true,
        credentials: {
          coinbase: { configured: true, keyHint: "…1234" },
        },
        connection: { status: "error", error: "Invalid API key" },
      }),
    );
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "wallet"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Failed");
    expect(output).toContain("Invalid API key");
  });

  it("should show testnet badge", async () => {
    mockGetWalletStatus.mockResolvedValue(
      makeStatus({
        network: "base-sepolia",
        isTestnet: true,
      }),
    );
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "wallet"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("testnet");
  });

  it("should produce JSON output", async () => {
    mockGetWalletStatus.mockResolvedValue(makeStatus());
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "--json", "wallet"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.network).toBe("base");
    expect(parsed.data.canPay).toBe(false);
  });

  it("should show budget limits when configured", async () => {
    mockGetWalletStatus.mockResolvedValue(
      makeStatus({
        budget: {
          dailySpent: Money.fromCents(100n),
          monthlySpent: Money.zero(),
          dailyLimit: Money.fromDollars("10.00"),
          monthlyLimit: undefined,
          perTransactionLimit: undefined,
          dailyRemaining: Money.fromDollars("9.00"),
          monthlyRemaining: undefined,
        },
      }),
    );
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "wallet"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("$1.00");
    expect(output).toContain("$10.00");
    expect(output).toContain("$9.00");
  });
});
