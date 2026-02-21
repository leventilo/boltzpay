import { Money, ProtocolError } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerCheckCommand } from "../../src/commands/check.js";

const mockQuote = vi.fn();

vi.mock("../../src/config.js", () => ({
  createSdkFromEnv: () => ({
    fetch: vi.fn(),
    quote: mockQuote,
    getBudget: vi.fn(),
    getHistory: vi.fn(),
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
  registerCheckCommand(program);
  return program;
}

describe("check command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mockQuote.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should show paid endpoint in human mode when quote succeeds", async () => {
    mockQuote.mockResolvedValue({
      amount: Money.fromDollars("0.05"),
      protocol: "x402",
      network: "base",
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "check",
      "https://api.example.com/paid",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Paid endpoint");
    expect(output).toContain("x402");
    expect(output).toContain("$0.05");
  });

  it("should show free endpoint in human mode when detection fails", async () => {
    mockQuote.mockRejectedValue(
      new ProtocolError("protocol_detection_failed", "No protocol detected"),
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "check",
      "https://free.example.com",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Free endpoint");
  });

  it("should produce JSON output for paid endpoint", async () => {
    mockQuote.mockResolvedValue({
      amount: Money.fromDollars("0.10"),
      protocol: "x402",
      network: "base-sepolia",
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "--json",
      "check",
      "https://api.example.com/paid",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.isPaid).toBe(true);
    expect(parsed.data.protocol).toBe("x402");
    expect(parsed.data.amount).toBe("$0.10");
  });

  it("should produce JSON output for free endpoint", async () => {
    mockQuote.mockRejectedValue(
      new ProtocolError("protocol_detection_failed", "No protocol detected"),
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "--json",
      "check",
      "https://free.example.com",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.isPaid).toBe(false);
  });

  it("should show Options when multiple chains available", async () => {
    mockQuote.mockResolvedValue({
      amount: Money.fromDollars("0.05"),
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
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "check",
      "https://api.example.com/multi",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Options");
    expect(output).toContain("Base");
    expect(output).toContain("Solana");
    expect(output).toContain("recommended");
  });

  it("should include options in JSON when multiple chains available", async () => {
    mockQuote.mockResolvedValue({
      amount: Money.fromDollars("0.05"),
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
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "--json",
      "check",
      "https://api.example.com/multi",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.data.options).toHaveLength(2);
    expect(parsed.data.options[0].chain).toBe("Base");
    expect(parsed.data.options[1].chain).toBe("Solana");
  });
});
