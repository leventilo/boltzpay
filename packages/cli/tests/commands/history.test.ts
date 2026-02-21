import { Money } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerHistoryCommand } from "../../src/commands/history.js";

const mockGetHistory = vi.fn();

vi.mock("../../src/config.js", () => ({
  createSdkFromEnv: () => ({
    fetch: vi.fn(),
    quote: vi.fn(),
    getBudget: vi.fn(),
    getHistory: mockGetHistory,
    close: vi.fn(),
  }),
  CliConfigurationError: class extends Error {
    readonly code = "missing_credentials" as const;
  },
}));

function noop(): void {}

vi.spyOn(process, "exit").mockImplementation(noop as () => never);

function createProgram(): Command {
  const program = new Command();
  program.option("--json", "JSON output", false);
  registerHistoryCommand(program);
  return program;
}

describe("history command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mockGetHistory.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should list payment records in human mode with chain column", async () => {
    mockGetHistory.mockReturnValue([
      {
        id: "pay-1",
        url: "https://api.example.com/data",
        protocol: "x402",
        amount: Money.fromDollars("0.05"),
        timestamp: new Date("2026-02-18T10:00:00Z"),
        txHash: "0xabc",
        network: "eip155:8453",
      },
    ]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "history"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Payment History");
    expect(output).toContain("x402");
    expect(output).toContain("$0.05");
    expect(output).toContain("Base");
    expect(output).toContain("1 payment(s) total");
  });

  it("should show chain totals when multiple records exist", async () => {
    mockGetHistory.mockReturnValue([
      {
        id: "pay-1",
        url: "https://api.example.com/data",
        protocol: "x402",
        amount: Money.fromDollars("0.05"),
        timestamp: new Date("2026-02-18T10:00:00Z"),
        txHash: "0xabc",
        network: "eip155:8453",
      },
      {
        id: "pay-2",
        url: "https://api.other.com",
        protocol: "x402",
        amount: Money.fromDollars("0.05"),
        timestamp: new Date("2026-02-18T10:01:00Z"),
        txHash: "0xdef",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      },
    ]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "history"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("2 payment(s) total");
    expect(output).toContain("By chain:");
    expect(output).toContain("Base");
    expect(output).toContain("Solana");
  });

  it("should produce JSON output with chain field per record", async () => {
    const timestamp = new Date("2026-02-18T10:00:00Z");
    mockGetHistory.mockReturnValue([
      {
        id: "pay-1",
        url: "https://api.example.com/data",
        protocol: "x402",
        amount: Money.fromDollars("0.05"),
        timestamp,
        txHash: "0xdef",
        network: "eip155:8453",
      },
    ]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "--json", "history"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].protocol).toBe("x402");
    expect(parsed.data[0].amount).toBe("$0.05");
    expect(parsed.data[0].txHash).toBe("0xdef");
    expect(parsed.data[0].chain).toBe("Base");
    expect(parsed.data[0].network).toBe("eip155:8453");
  });

  it("should show empty history message", async () => {
    mockGetHistory.mockReturnValue([]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "history"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No payments made yet");
  });

  it("should show dash for unknown network", async () => {
    mockGetHistory.mockReturnValue([
      {
        id: "pay-1",
        url: "https://api.example.com/data",
        protocol: "l402",
        amount: Money.fromDollars("0.10"),
        timestamp: new Date("2026-02-18T10:00:00Z"),
        txHash: undefined,
        network: undefined,
      },
    ]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "history"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("\u2014"); // em-dash for undefined network
  });
});
