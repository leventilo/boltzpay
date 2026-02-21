import { Money } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerFetchCommand } from "../../src/commands/fetch.js";

const mockFetch = vi.fn();
const mockGetBudget = vi.fn();

vi.mock("../../src/config.js", () => ({
  createSdkFromEnv: () => ({
    fetch: mockFetch,
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
  program.option("--verbose", "Verbose output", false);
  program.option("--debug", "Debug output", false);
  registerFetchCommand(program);
  return program;
}

function makeResponse(
  overrides: {
    status?: number;
    payment?: { protocol: string; amount: Money; txHash?: string } | null;
    headers?: Record<string, string>;
    body?: string;
    protocol?: string | null;
  } = {},
) {
  const body = overrides.body ?? '{"result": "ok"}';
  return {
    ok: (overrides.status ?? 200) < 400,
    status: overrides.status ?? 200,
    headers: overrides.headers ?? { "content-type": "application/json" },
    payment: overrides.payment ?? null,
    protocol: overrides.protocol ?? null,
    text: vi.fn().mockResolvedValue(body),
  };
}

describe("fetch command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call SDK fetch with correct URL and method", async () => {
    mockFetch.mockResolvedValue(makeResponse());
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "fetch",
      "https://api.example.com/data",
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("should pass custom method via --method", async () => {
    mockFetch.mockResolvedValue(makeResponse());
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "fetch",
      "https://api.example.com/data",
      "-m",
      "POST",
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("should produce human output with response data", async () => {
    mockFetch.mockResolvedValue(makeResponse({ body: "hello world" }));
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "fetch",
      "https://api.example.com/data",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Response");
    expect(output).toContain("hello world");
  });

  it("should produce JSON output with envelope structure", async () => {
    mockFetch.mockResolvedValue(makeResponse({ body: "test body" }));
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "--json",
      "fetch",
      "https://api.example.com/data",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe("test body");
    expect(parsed.metadata.url).toBe("https://api.example.com/data");
    expect(parsed.metadata.status).toBe(200);
  });

  it("should include payment info in JSON when payment occurred", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({
        payment: {
          protocol: "x402",
          amount: Money.fromDollars("0.05"),
          txHash: "0xabc123def456",
        },
      }),
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "--json",
      "fetch",
      "https://api.example.com/paid",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.payment).not.toBeNull();
    expect(parsed.payment.protocol).toBe("x402");
    expect(parsed.payment.amount).toBe("$0.05");
    expect(parsed.payment.txHash).toBe("0xabc123def456");
  });

  it("should set payment to null in JSON for free endpoint", async () => {
    mockFetch.mockResolvedValue(makeResponse({ payment: null }));
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "--json",
      "fetch",
      "https://free.example.com",
    ]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.payment).toBeNull();
  });

  it("should parse headers from -H option", async () => {
    mockFetch.mockResolvedValue(makeResponse());
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "fetch",
      "https://api.example.com/data",
      "-H",
      "Authorization:Bearer token123",
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({
        headers: { Authorization: "Bearer token123" },
      }),
    );
  });

  it("should pass --chain option to SDK fetch", async () => {
    mockFetch.mockResolvedValue(makeResponse());
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "fetch",
      "https://api.example.com/data",
      "--chain",
      "svm",
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({
        chain: "svm",
      }),
    );
  });

  it("should reject invalid chain value", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(noop as () => never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "fetch",
      "https://api.example.com/data",
      "--chain",
      "bitcoin",
    ]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(errOutput).toContain("Invalid chain");
  });

  it("should reject invalid URL before calling SDK", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(noop as () => never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "fetch",
      "not-a-valid-url",
    ]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(errOutput).toContain("Invalid URL");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should handle SDK error with correct exit code", async () => {
    const { BudgetExceededError } = await import("@boltzpay/sdk");
    mockFetch.mockRejectedValue(
      new BudgetExceededError(
        "daily_budget_exceeded",
        Money.fromDollars("5.00"),
        Money.fromDollars("1.00"),
      ),
    );
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(noop as () => never);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "fetch",
      "https://api.example.com/data",
    ]);

    expect(exitSpy).toHaveBeenCalledWith(3);
  });
});
