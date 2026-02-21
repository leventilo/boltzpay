import { Money, ProtocolError } from "@boltzpay/sdk";
import type { WalletStatus } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerDemoCommand } from "../../src/commands/demo.js";

const mockGetWalletStatus = vi.fn<() => Promise<WalletStatus>>();
const mockGetCapabilities = vi.fn();
const mockQuote = vi.fn();
const mockFetch = vi.fn();
const mockGetHistory = vi.fn();
const mockGetBudget = vi.fn();
const mockClose = vi.fn();

vi.mock("../../src/config.js", () => ({
  createSdkFromEnv: () => ({
    getWalletStatus: mockGetWalletStatus,
    getCapabilities: mockGetCapabilities,
    quote: mockQuote,
    fetch: mockFetch,
    getHistory: mockGetHistory,
    getBudget: mockGetBudget,
    close: mockClose,
  }),
}));

function noop(): void {}
vi.spyOn(process, "exit").mockImplementation(noop as () => never);

function createProgram(): Command {
  const program = new Command();
  program.option("--json", "JSON output", false);
  registerDemoCommand(program);
  return program;
}

function makeWalletStatus(
  overrides: Partial<WalletStatus> = {},
): WalletStatus {
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

describe("demo command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    mockGetWalletStatus.mockReset();
    mockGetCapabilities.mockReset();
    mockQuote.mockReset();
    mockFetch.mockReset();
    mockGetHistory.mockReset();
    mockGetBudget.mockReset();
    mockClose.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs in read-only mode when no credentials are configured", async () => {
    mockGetWalletStatus.mockResolvedValue(makeWalletStatus());
    mockGetCapabilities.mockReturnValue({
      network: "base",
      protocols: ["x402"],
      canPay: false,
      canPayLightning: false,
      chains: ["evm", "svm"],
      addresses: {},
    });
    mockQuote.mockResolvedValue({
      amount: Money.fromDollars("0.01"),
      protocol: "x402",
      network: "eip155:8453",
    });

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "demo", "--yes"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("BoltzPay Demo");
    expect(output).toContain("Checking wallet status");
    expect(output).toContain("Read-only mode");
    expect(output).toContain("Demo complete");
    expect(mockClose).toHaveBeenCalled();
  });

  it("selects testnet endpoint when --testnet is passed", async () => {
    mockGetWalletStatus.mockResolvedValue(
      makeWalletStatus({ network: "base-sepolia", isTestnet: true }),
    );
    mockGetCapabilities.mockReturnValue({
      network: "base-sepolia",
      protocols: ["x402"],
      canPay: false,
      canPayLightning: false,
      chains: ["evm", "svm"],
      addresses: {},
    });
    mockQuote.mockResolvedValue({
      amount: Money.fromCents(1n),
      protocol: "x402",
      network: "eip155:84532",
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "demo",
      "--testnet",
      "--yes",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Nickel Joke (testnet)");
    expect(output).toContain("nickeljoke.vercel.app");
  });

  it("skips confirmation prompt when --yes is passed", async () => {
    mockGetWalletStatus.mockResolvedValue(
      makeWalletStatus({
        canPay: true,
        credentials: {
          coinbase: { configured: true, keyHint: "…abcd" },
        },
        connection: { status: "connected", latencyMs: 120 },
      }),
    );
    mockGetCapabilities.mockReturnValue({
      network: "base",
      protocols: ["x402"],
      canPay: true,
      canPayLightning: false,
      chains: ["evm", "svm"],
      addresses: {},
    });
    mockQuote.mockResolvedValue({
      amount: Money.fromDollars("0.01"),
      protocol: "x402",
      network: "eip155:8453",
    });
    mockFetch.mockResolvedValue({
      status: 200,
      text: async () => '{"joke":"Why did the Bitcoin cross the blockchain?"}',
      payment: {
        protocol: "x402",
        amount: Money.fromDollars("0.01"),
        url: "https://x402-tools.vercel.app/api/polymarket/trending",
        timestamp: new Date(),
      },
    });
    mockGetHistory.mockReturnValue([
      { id: "1", url: "https://x402-tools.vercel.app/api/polymarket/trending" },
    ]);
    mockGetBudget.mockReturnValue({
      dailySpent: Money.fromDollars("0.01"),
      monthlySpent: Money.zero(),
    });

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "demo", "--yes"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Fetching with payment");
    expect(output).toContain("Status: 200");
    expect(output).toContain("Payments made: 1");
    expect(output).toContain("Demo complete");
  });

  it("handles quote failure gracefully for free endpoints", async () => {
    mockGetWalletStatus.mockResolvedValue(makeWalletStatus());
    mockGetCapabilities.mockReturnValue({
      network: "base",
      protocols: ["x402"],
      canPay: false,
      canPayLightning: false,
      chains: ["evm", "svm"],
      addresses: {},
    });
    mockQuote.mockRejectedValue(
      new ProtocolError("protocol_detection_failed", "No protocol detected"),
    );

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "demo", "--yes"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("free");
    expect(output).toContain("Demo complete");
    expect(mockClose).toHaveBeenCalled();
  });
});
