import type { DiscoveredEntry } from "@boltzpay/sdk";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerDiscoverCommand } from "../../src/commands/discover.js";

const mockDiscover = vi.fn();

vi.mock("../../src/config.js", () => ({
  createSdkFromEnv: () => ({
    discover: mockDiscover,
    close: vi.fn(),
  }),
}));

function noop(): void {}
vi.spyOn(process, "exit").mockImplementation(noop as () => never);

function createProgram(): Command {
  const program = new Command();
  program.option("--json", "JSON output", false);
  registerDiscoverCommand(program);
  return program;
}

const healthyEntry: DiscoveredEntry = {
  slug: "test-api",
  name: "Test API",
  url: "https://api.test.com/v1/data",
  protocol: "x402",
  score: 85,
  health: "healthy",
  category: "crypto-data",
  isPaid: true,
  badge: "established",
};

const degradedEntry: DiscoveredEntry = {
  slug: "degraded-api",
  name: "Degraded API",
  url: "https://degraded.example.com",
  protocol: "l402",
  score: 55,
  health: "degraded",
  category: "ai",
  isPaid: true,
  badge: null,
};

const deadEntry: DiscoveredEntry = {
  slug: "dead-api",
  name: "Dead API",
  url: "https://dead.example.com",
  protocol: "mpp",
  score: 15,
  health: "dead",
  category: "utilities",
  isPaid: true,
  badge: "new",
};

describe("discover command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mockDiscover.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes --protocol to discover options", async () => {
    mockDiscover.mockResolvedValue([healthyEntry]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "discover", "-p", "x402"]);

    expect(mockDiscover).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "x402" }),
    );
  });

  it("passes --min-score to discover options as number", async () => {
    mockDiscover.mockResolvedValue([healthyEntry]);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "discover",
      "--min-score",
      "70",
    ]);

    expect(mockDiscover).toHaveBeenCalledWith(
      expect.objectContaining({ minScore: 70 }),
    );
  });

  it("passes --query to discover options", async () => {
    mockDiscover.mockResolvedValue([healthyEntry]);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "discover",
      "-q",
      "weather",
    ]);

    expect(mockDiscover).toHaveBeenCalledWith(
      expect.objectContaining({ query: "weather" }),
    );
  });

  it("passes --category to discover options", async () => {
    mockDiscover.mockResolvedValue([healthyEntry]);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "boltzpay",
      "discover",
      "-c",
      "crypto-data",
    ]);

    expect(mockDiscover).toHaveBeenCalledWith(
      expect.objectContaining({ category: "crypto-data" }),
    );
  });

  it("outputs formatted table with score, health, protocol in text mode", async () => {
    mockDiscover.mockResolvedValue([healthyEntry, degradedEntry, deadEntry]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "discover"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Registry Endpoints");
    expect(output).toContain("Test API");
    expect(output).toContain("85");
    expect(output).toContain("healthy");
    expect(output).toContain("x402");
    expect(output).toContain("degraded");
    expect(output).toContain("dead");
    expect(output).toContain("endpoints total");
  });

  it("outputs flat JSON array in json mode", async () => {
    mockDiscover.mockResolvedValue([healthyEntry, degradedEntry]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "--json", "discover"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0].slug).toBe("test-api");
    expect(parsed.data[0].score).toBe(85);
    expect(parsed.data[0].health).toBe("healthy");
    expect(parsed.data[1].protocol).toBe("l402");
  });

  it("shows empty message when no results", async () => {
    mockDiscover.mockResolvedValue([]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "discover"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No matching endpoints found");
  });
});
