import { Money } from "@boltzpay/sdk";
import type { DiagnoseResult } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerDiagnoseCommand } from "../../src/commands/diagnose.js";

const mockDiagnose = vi.fn();
const mockClose = vi.fn();

vi.mock("../../src/config.js", () => ({
  createSdkFromEnv: () => ({
    diagnose: mockDiagnose,
    close: mockClose,
  }),
}));

function noop(): void {}
vi.spyOn(process, "exit").mockImplementation(noop as () => never);

function createProgram(): Command {
  const program = new Command();
  program.option("-j, --json", "Output as JSON envelope", false);
  registerDiagnoseCommand(program);
  return program;
}

function makeResult(overrides: Partial<DiagnoseResult> = {}): DiagnoseResult {
  return {
    url: "https://api.example.com/data",
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

describe("diagnose command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    mockDiagnose.mockReset();
    mockClose.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call sdk.diagnose(url) and display formatted text result", async () => {
    mockDiagnose.mockResolvedValue(makeResult());
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "diagnose",
      "https://api.example.com/data",
    ]);

    expect(mockDiagnose).toHaveBeenCalledWith("https://api.example.com/data");
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Endpoint Diagnostic");
  });

  it("should display protocol, format version, scheme, network, price, facilitator, health, latency", async () => {
    mockDiagnose.mockResolvedValue(makeResult());
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "diagnose",
      "https://api.example.com/data",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("x402");
    expect(output).toContain("V2 header");
    expect(output).toContain("exact");
    expect(output).toContain("Base");
    expect(output).toContain("$0.05");
    expect(output).toContain("0x1234...abcd");
    expect(output).toContain("healthy");
    expect(output).toContain("120ms");
  });

  it("should include rawAccepts and timing in JSON output", async () => {
    const rawAccepts = [
      {
        namespace: "evm",
        network: "eip155:8453",
        amount: 5n,
        payTo: "0xabc",
        asset: "USDC",
        scheme: "exact",
      },
    ];
    mockDiagnose.mockResolvedValue(
      makeResult({
        rawAccepts,
        timing: { detectMs: 50, quoteMs: 70 },
      }),
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "--json",
      "diagnose",
      "https://api.example.com/data",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.rawAccepts).toBeDefined();
    expect(parsed.data.timing).toEqual({ detectMs: 50, quoteMs: 70 });
  });

  it("should show 'Free endpoint' message for non-paid endpoints", async () => {
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
      "diagnose",
      "https://free.example.com",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Free endpoint");
  });

  it("should show dead health status for dead endpoints", async () => {
    mockDiagnose.mockResolvedValue(
      makeResult({
        health: "dead",
        isPaid: false,
        protocol: undefined,
        price: undefined,
      }),
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "diagnose",
      "https://dead.example.com",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("dead");
  });

  it("should display all chains for multi-chain endpoints", async () => {
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
      "diagnose",
      "https://api.example.com/multi",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Available Chains");
    expect(output).toContain("evm");
    expect(output).toContain("svm");
  });

  it("should show POST-only note in format field", async () => {
    mockDiagnose.mockResolvedValue(
      makeResult({
        postOnly: true,
        formatVersion: "V1 body",
      }),
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "diagnose",
      "https://api.example.com/post-only",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("POST-only");
  });

  it("should always call sdk.close() in finally block", async () => {
    mockDiagnose.mockResolvedValue(makeResult());
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "diagnose",
      "https://api.example.com/data",
    ]);

    expect(mockClose).toHaveBeenCalled();
  });

  it("should display degraded health with warning indicator", async () => {
    mockDiagnose.mockResolvedValue(
      makeResult({
        health: "degraded",
        scheme: "upto",
      }),
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "diagnose",
      "https://api.example.com/upto",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("degraded");
  });
});
