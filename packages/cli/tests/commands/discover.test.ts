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

const liveEntry: DiscoveredEntry = {
  name: "Invy — Token Holdings",
  url: "https://invy.bot/api",
  protocol: "x402",
  category: "crypto-data",
  description: "Token holdings lookup",
  pricing: "$0.05",
  live: {
    status: "live",
    livePrice: "$0.05",
    protocol: "x402",
    network: "eip155:8453",
  },
};

const freeEntry: DiscoveredEntry = {
  name: "Free API",
  url: "https://free.example.com",
  protocol: "x402",
  category: "demo",
  description: "A free endpoint",
  pricing: "$0.00",
  live: { status: "free" },
};

const offlineEntry: DiscoveredEntry = {
  name: "Offline API",
  url: "https://offline.example.com",
  protocol: "x402",
  category: "utilities",
  description: "Offline endpoint",
  pricing: "$0.01",
  live: { status: "offline", reason: "Timeout" },
};

const errorEntry: DiscoveredEntry = {
  name: "Error API",
  url: "https://error.example.com",
  protocol: "x402",
  category: "utilities",
  description: "Error endpoint",
  pricing: "$0.02",
  live: { status: "error", reason: "Unknown failure" },
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

  it("should display enriched entries with status badges in human mode", async () => {
    mockDiscover.mockResolvedValue([liveEntry, offlineEntry, errorEntry, freeEntry]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "discover"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Compatible Paid API Endpoints");
    expect(output).toContain("LIVE");
    expect(output).toContain("Invy");
    expect(output).toContain("$0.05");
    expect(output).toContain("FREE");
    expect(output).toContain("OFFLINE");
    expect(output).toContain("unverified");
    expect(output).toContain("ERROR");
    expect(output).toContain("endpoint(s)");
  });

  it("should pass category to sdk.discover()", async () => {
    mockDiscover.mockResolvedValue([liveEntry]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "discover", "-c", "crypto-data"]);

    expect(mockDiscover).toHaveBeenCalledWith({
      category: "crypto-data",
      enableLiveDiscovery: true,
    });
  });

  it("should show no results for empty response", async () => {
    mockDiscover.mockResolvedValue([]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "discover", "-c", "nonexistent"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No matching endpoints found");
    expect(output).toContain("Available categories");
  });

  it("should produce enriched JSON output", async () => {
    mockDiscover.mockResolvedValue([liveEntry, freeEntry, offlineEntry]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "--json", "discover"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(3);

    const live = parsed.data[0];
    expect(live.status).toBe("live");
    expect(live.price).toBe("$0.05");
    expect(live.isPriceVerified).toBe(true);
    expect(live.detectedProtocol).toBe("x402");

    const free = parsed.data[1];
    expect(free.status).toBe("free");
    expect(free.price).toBe("Free");
    expect(free.isPriceVerified).toBe(true);

    const offline = parsed.data[2];
    expect(offline.status).toBe("offline");
    expect(offline.isPriceVerified).toBe(false);
  });

  it("should produce empty JSON array for no results", async () => {
    mockDiscover.mockResolvedValue([]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "--json", "discover", "-c", "nonexistent"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual([]);
  });

  it("should display summary counts", async () => {
    mockDiscover.mockResolvedValue([liveEntry, liveEntry, offlineEntry, freeEntry]);
    const program = createProgram();
    await program.parseAsync(["node", "boltzpay", "discover"]);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("4 endpoint(s)");
    expect(output).toContain("2 live");
    expect(output).toContain("1 offline");
    expect(output).toContain("1 free");
  });
});
