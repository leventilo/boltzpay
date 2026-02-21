import { Money } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerBudgetCommand } from "../../src/commands/budget.js";

const mockGetBudget = vi.fn();

vi.mock("../../src/config.js", () => ({
  createSdkFromEnv: () => ({
    fetch: vi.fn(),
    quote: vi.fn(),
    getBudget: mockGetBudget,
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
  registerBudgetCommand(program);
  return program;
}

describe("budget command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mockGetBudget.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should show human output with budget limits and spending", async () => {
    mockGetBudget.mockReturnValue({
      dailySpent: Money.fromDollars("2.50"),
      monthlySpent: Money.fromDollars("10.00"),
      dailyLimit: Money.fromDollars("10.00"),
      monthlyLimit: undefined,
      perTransactionLimit: undefined,
      dailyRemaining: Money.fromDollars("7.50"),
      monthlyRemaining: undefined,
    });
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "budget"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Budget Status");
    expect(output).toContain("Daily");
    expect(output).toContain("$2.50");
    expect(output).toContain("$10.00");
  });

  it("should produce JSON output with budget breakdown", async () => {
    mockGetBudget.mockReturnValue({
      dailySpent: Money.fromDollars("1.00"),
      monthlySpent: Money.fromDollars("5.00"),
      dailyLimit: Money.fromDollars("10.00"),
      monthlyLimit: Money.fromDollars("100.00"),
      perTransactionLimit: Money.fromDollars("2.00"),
      dailyRemaining: Money.fromDollars("9.00"),
      monthlyRemaining: Money.fromDollars("95.00"),
    });
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "--json", "budget"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.dailySpent).toBe("$1.00");
    expect(parsed.data.dailyLimit).toBe("$10.00");
    expect(parsed.data.monthlyLimit).toBe("$100.00");
    expect(parsed.data.perTransactionLimit).toBe("$2.00");
  });

  it("should show no budget configured message", async () => {
    mockGetBudget.mockReturnValue({
      dailySpent: Money.zero(),
      monthlySpent: Money.zero(),
      dailyLimit: undefined,
      monthlyLimit: undefined,
      perTransactionLimit: undefined,
      dailyRemaining: undefined,
      monthlyRemaining: undefined,
    });
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "budget"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No budget limits configured");
  });
});
