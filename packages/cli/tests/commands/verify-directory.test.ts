import { Money } from "@boltzpay/sdk";
import type { DiagnoseResult } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerVerifyDirectoryCommand } from "../../src/commands/verify-directory.js";

const mockDiagnose = vi.fn();
const mockClose = vi.fn();

vi.mock("../../src/config.js", () => ({
  createSdkFromEnv: () => ({
    diagnose: mockDiagnose,
    close: mockClose,
  }),
}));

const mockGetMergedDirectory = vi.fn();
vi.mock("@boltzpay/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@boltzpay/sdk")>();
  return {
    ...actual,
    getMergedDirectory: (...args: unknown[]) => mockGetMergedDirectory(...args),
  };
});

function noop(): void {}
vi.spyOn(process, "exit").mockImplementation(noop as () => never);

function createProgram(): Command {
  const program = new Command();
  program.option("-j, --json", "Output as JSON envelope", false);
  registerVerifyDirectoryCommand(program);
  return program;
}

function makeDiagnoseResult(
  overrides: Partial<DiagnoseResult> = {},
): DiagnoseResult {
  return {
    url: "https://api.example.com/data",
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

const testDirectory = [
  {
    name: "Service A",
    url: "https://a.example.com",
    protocol: "x402",
    category: "ai",
    description: "AI service",
    pricing: "$0.05",
  },
  {
    name: "Service B",
    url: "https://b.example.com",
    protocol: "x402",
    category: "data",
    description: "Data service",
    pricing: "$0.10",
  },
  {
    name: "Service C",
    url: "https://c.example.com",
    protocol: "l402",
    category: "tools",
    description: "Tool service",
    pricing: "$0.01",
  },
];

describe("verify-directory command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitCodeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    process.exitCode = undefined;
    mockDiagnose.mockReset();
    mockClose.mockReset();
    mockGetMergedDirectory.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("should probe all directory entries and output table", async () => {
    mockGetMergedDirectory.mockResolvedValue(testDirectory);
    mockDiagnose.mockResolvedValue(makeDiagnoseResult());

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "verify-directory"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Service A");
    expect(output).toContain("Service B");
    expect(output).toContain("Service C");
  });

  it("should show status emoji, protocol, and price in each row", async () => {
    mockGetMergedDirectory.mockResolvedValue([testDirectory[0]]);
    mockDiagnose.mockResolvedValue(
      makeDiagnoseResult({ health: "healthy", protocol: "x402" }),
    );

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "verify-directory"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("x402");
    expect(output).toContain("$0.05");
  });

  it("should display summary line with counts", async () => {
    mockGetMergedDirectory.mockResolvedValue(testDirectory);
    mockDiagnose
      .mockResolvedValueOnce(makeDiagnoseResult({ health: "healthy" }))
      .mockResolvedValueOnce(makeDiagnoseResult({ health: "degraded" }))
      .mockResolvedValueOnce(makeDiagnoseResult({ health: "dead" }));

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "verify-directory"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("1 healthy");
    expect(output).toContain("1 degraded");
    expect(output).toContain("1 dead");
  });

  it("should exit code 0 when all healthy or degraded", async () => {
    mockGetMergedDirectory.mockResolvedValue(testDirectory.slice(0, 2));
    mockDiagnose
      .mockResolvedValueOnce(makeDiagnoseResult({ health: "healthy" }))
      .mockResolvedValueOnce(makeDiagnoseResult({ health: "degraded" }));

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "verify-directory"]);

    expect(process.exitCode).not.toBe(1);
  });

  it("should exit code 1 when at least one dead entry", async () => {
    mockGetMergedDirectory.mockResolvedValue(testDirectory);
    mockDiagnose
      .mockResolvedValueOnce(makeDiagnoseResult({ health: "healthy" }))
      .mockResolvedValueOnce(makeDiagnoseResult({ health: "healthy" }))
      .mockResolvedValueOnce(makeDiagnoseResult({ health: "dead" }));

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "verify-directory"]);

    expect(process.exitCode).toBe(1);
  });

  it("should limit concurrency to 10", async () => {
    // Create 15 entries to test that no more than 10 run at once
    const manyEntries = Array.from({ length: 15 }, (_, i) => ({
      name: `Service ${i}`,
      url: `https://s${i}.example.com`,
      protocol: "x402",
      category: "test",
      description: "Test",
      pricing: "$0.01",
    }));
    mockGetMergedDirectory.mockResolvedValue(manyEntries);

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    mockDiagnose.mockImplementation(async () => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      // Simulate async delay
      await new Promise((r) => setTimeout(r, 10));
      currentConcurrent--;
      return makeDiagnoseResult();
    });

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "verify-directory"]);

    expect(maxConcurrent).toBeLessThanOrEqual(10);
    expect(maxConcurrent).toBeGreaterThan(1); // Should actually use concurrency
  });

  it("should write progress counter to stderr", async () => {
    mockGetMergedDirectory.mockResolvedValue(testDirectory);
    mockDiagnose.mockResolvedValue(makeDiagnoseResult());

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "verify-directory"]);

    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrOutput).toContain("Scanning");
    expect(stderrOutput).toContain(`${testDirectory.length}`);
  });

  it("should output JSON array in json mode", async () => {
    mockGetMergedDirectory.mockResolvedValue(testDirectory.slice(0, 1));
    mockDiagnose.mockResolvedValue(
      makeDiagnoseResult({ health: "healthy", protocol: "x402" }),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "--json",
      "verify-directory",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data[0].name).toBe("Service A");
    expect(parsed.data[0].health).toBe("healthy");
  });

  it("should handle diagnose errors gracefully (mark as dead)", async () => {
    mockGetMergedDirectory.mockResolvedValue(testDirectory.slice(0, 1));
    mockDiagnose.mockRejectedValue(new Error("Network error"));

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "verify-directory"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("dead");
  });

  it("should always call sdk.close() in finally block", async () => {
    mockGetMergedDirectory.mockResolvedValue(testDirectory.slice(0, 1));
    mockDiagnose.mockResolvedValue(makeDiagnoseResult());

    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "verify-directory"]);

    expect(mockClose).toHaveBeenCalled();
  });
});
