import { Money } from "@boltzpay/sdk";
import type { DiagnoseResult } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// check is now an alias for diagnose — test via registerDiagnoseCommand
import { registerDiagnoseCommand } from "../../src/commands/diagnose.js";

const mockDiagnose = vi.fn();

vi.mock("../../src/config.js", () => ({
  createSdkFromEnv: () => ({
    diagnose: mockDiagnose,
    close: vi.fn(),
  }),
}));

function noop(): void {}

vi.spyOn(process, "exit").mockImplementation(noop as () => never);

function createProgram(): Command {
  const program = new Command();
  program.option("--json", "JSON output", false);
  registerDiagnoseCommand(program);
  return program;
}

function makeResult(overrides: Partial<DiagnoseResult> = {}): DiagnoseResult {
  return {
    url: "https://api.example.com/paid",
    classification: "paid",
    isPaid: true,
    protocol: "x402",
    formatVersion: "V2 header",
    scheme: "exact",
    network: "eip155:8453",
    price: Money.fromDollars("0.05"),
    facilitator: "0x1234...abcd",
    health: "healthy",
    latencyMs: 120,
    postOnly: false,
    ...overrides,
  };
}

describe("check command (alias for diagnose)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mockDiagnose.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should show paid endpoint in human mode via check alias", async () => {
    mockDiagnose.mockResolvedValue(makeResult());
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "check",
      "https://api.example.com/paid",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Endpoint Diagnostic");
    expect(output).toContain("x402");
    expect(output).toContain("$0.05");
  });

  it("should show free endpoint in human mode", async () => {
    mockDiagnose.mockResolvedValue(
      makeResult({
        classification: "free_confirmed",
        isPaid: false,
        protocol: undefined,
        formatVersion: undefined,
        scheme: undefined,
        network: undefined,
        price: undefined,
        facilitator: undefined,
        health: "healthy",
      }),
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

  it("should produce JSON output for paid endpoint via check alias", async () => {
    mockDiagnose.mockResolvedValue(makeResult());
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
    expect(parsed.data.price).toBe("$0.05");
  });

  it("should produce JSON output for free endpoint via check alias", async () => {
    mockDiagnose.mockResolvedValue(
      makeResult({
        isPaid: false,
        protocol: undefined,
        price: undefined,
        health: "healthy",
      }),
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

  it("should show Options when multiple chains available via check alias", async () => {
    mockDiagnose.mockResolvedValue(
      makeResult({
        chains: [
          {
            namespace: "evm",
            network: "eip155:8453",
            price: Money.fromDollars("0.05"),
            payTo: "0xabc",
            scheme: "exact",
          },
          {
            namespace: "svm",
            network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
            price: Money.fromDollars("0.05"),
            payTo: "5xyz",
            scheme: "exact",
          },
        ],
      }),
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "check",
      "https://api.example.com/multi",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Available Chains");
    expect(output).toContain("evm");
    expect(output).toContain("svm");
  });

  it("should include chains in JSON when multiple chains available", async () => {
    mockDiagnose.mockResolvedValue(
      makeResult({
        chains: [
          {
            namespace: "evm",
            network: "eip155:8453",
            price: Money.fromDollars("0.05"),
            payTo: "0xabc",
            scheme: "exact",
          },
          {
            namespace: "svm",
            network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
            price: Money.fromDollars("0.05"),
            payTo: "5xyz",
            scheme: "exact",
          },
        ],
        rawAccepts: [
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
      }),
    );
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
    expect(parsed.data.chains).toHaveLength(2);
    expect(parsed.data.rawAccepts).toHaveLength(2);
  });
});
