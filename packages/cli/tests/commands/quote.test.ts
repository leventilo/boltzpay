import { Money, ProtocolError } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerQuoteCommand } from "../../src/commands/quote.js";

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
  program.option("--verbose", "Verbose output", false);
  registerQuoteCommand(program);
  return program;
}

describe("quote command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mockQuote.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should show human output with protocol and amount", async () => {
    mockQuote.mockResolvedValue({
      amount: Money.fromDollars("0.05"),
      protocol: "x402",
      network: "base",
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "quote",
      "https://api.example.com/paid",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Quote");
    expect(output).toContain("$0.05");
    expect(output).toContain("x402");
  });

  it("should produce JSON output with structured quote data", async () => {
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
      "quote",
      "https://api.example.com/paid",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.protocol).toBe("x402");
    expect(parsed.data.amount).toBe("$0.10");
    expect(parsed.data.network).toBe("base-sepolia");
  });

  it("should show free endpoint message when protocol detection fails", async () => {
    mockQuote.mockRejectedValue(
      new ProtocolError(
        "protocol_detection_failed",
        "No payment protocol detected",
      ),
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "quote",
      "https://free.example.com",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("free");
    expect(output).toContain("no payment required");
  });

  it("should show free endpoint JSON when protocol detection fails in JSON mode", async () => {
    mockQuote.mockRejectedValue(
      new ProtocolError(
        "protocol_detection_failed",
        "No payment protocol detected",
      ),
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "--json",
      "quote",
      "https://free.example.com",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.free).toBe(true);
  });

  it("should show Alternatives when allAccepts has multiple entries", async () => {
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
      "quote",
      "https://api.example.com/multi",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Alternatives");
    expect(output).toContain("Solana");
  });

  it("should include alternatives in JSON output", async () => {
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
      "quote",
      "https://api.example.com/multi",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.data.alternatives).toHaveLength(1);
    expect(parsed.data.alternatives[0].chain).toBe("Solana");
  });
});
