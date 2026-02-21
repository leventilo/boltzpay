import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildServerEntry,
  getConfigPath,
  readExistingConfig,
  writeClaudeDesktopConfig,
} from "../src/setup.js";

describe("getConfigPath", () => {
  it("should return a path ending with claude_desktop_config.json", () => {
    const configPath = getConfigPath();
    expect(configPath).toMatch(/claude_desktop_config\.json$/);
  });

  it("should return an absolute path", () => {
    const configPath = getConfigPath();
    expect(configPath.startsWith("/")).toBe(true);
  });
});

describe("readExistingConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `boltzpay-setup-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should return empty object when file does not exist", () => {
    const result = readExistingConfig(join(testDir, "nonexistent.json"));
    expect(result).toEqual({});
  });

  it("should parse valid JSON config", () => {
    const configPath = join(testDir, "config.json");
    const existing = { mcpServers: { other: { command: "other" } } };
    writeFileSync(configPath, JSON.stringify(existing));

    const result = readExistingConfig(configPath);
    expect(result).toEqual(existing);
  });

  it("should return null for invalid JSON", () => {
    const configPath = join(testDir, "bad.json");
    writeFileSync(configPath, "not json {{{");

    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = readExistingConfig(configPath);

    expect(result).toBeNull();
  });

  it("should return null for non-object JSON (array)", () => {
    const configPath = join(testDir, "array.json");
    writeFileSync(configPath, "[1, 2, 3]");

    const result = readExistingConfig(configPath);
    expect(result).toBeNull();
  });

  it("should return null for non-object JSON (string)", () => {
    const configPath = join(testDir, "string.json");
    writeFileSync(configPath, '"hello"');

    const result = readExistingConfig(configPath);
    expect(result).toBeNull();
  });

  it("should preserve all existing keys", () => {
    const configPath = join(testDir, "full.json");
    const existing = {
      mcpServers: { existing: { command: "test" } },
      someOtherKey: true,
    };
    writeFileSync(configPath, JSON.stringify(existing));

    const result = readExistingConfig(configPath);
    expect(result).toEqual(existing);
  });
});

describe("buildServerEntry", () => {
  const REQUIRED_CREDENTIALS = {
    COINBASE_API_KEY_ID: "key-id",
    COINBASE_API_KEY_SECRET: "key-secret",
    COINBASE_WALLET_SECRET: "wallet-secret",
  };

  it("should use npx command with @boltzpay/mcp arg", () => {
    const entry = buildServerEntry(REQUIRED_CREDENTIALS);

    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["-y", "@boltzpay/mcp"]);
  });

  it("should include all three Coinbase credentials in env", () => {
    const entry = buildServerEntry(REQUIRED_CREDENTIALS);

    expect(entry.env).toEqual({
      COINBASE_API_KEY_ID: "key-id",
      COINBASE_API_KEY_SECRET: "key-secret",
      COINBASE_WALLET_SECRET: "wallet-secret",
    });
  });

  it("should include NWC connection string in env when provided", () => {
    const entry = buildServerEntry({
      ...REQUIRED_CREDENTIALS,
      NWC_CONNECTION_STRING: "nostr+walletconnect://test",
    });

    expect(entry.env).toMatchObject({
      NWC_CONNECTION_STRING: "nostr+walletconnect://test",
    });
  });

  it("should include daily budget in env when provided", () => {
    const entry = buildServerEntry({
      ...REQUIRED_CREDENTIALS,
      BOLTZPAY_DAILY_BUDGET: "5.00",
    });

    expect(entry.env).toMatchObject({
      BOLTZPAY_DAILY_BUDGET: "5.00",
    });
  });

  it("should include all optional fields in env when provided", () => {
    const entry = buildServerEntry({
      ...REQUIRED_CREDENTIALS,
      NWC_CONNECTION_STRING: "nostr+walletconnect://test",
      BOLTZPAY_DAILY_BUDGET: "10.00",
    });

    const EXPECTED_KEY_COUNT = 5; // 3 required + 2 optional
    expect(Object.keys(entry.env as object)).toHaveLength(EXPECTED_KEY_COUNT);
  });
});

describe("writeClaudeDesktopConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `boltzpay-setup-write-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const SERVER_ENTRY = buildServerEntry({
    COINBASE_API_KEY_ID: "id",
    COINBASE_API_KEY_SECRET: "secret",
    COINBASE_WALLET_SECRET: "wallet",
  });

  it("should write valid JSON to config path", () => {
    const configPath = join(testDir, "config.json");
    vi.spyOn(console, "error").mockImplementation(() => {});

    writeClaudeDesktopConfig(configPath, {}, SERVER_ENTRY);

    const raw = readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();
  });

  it("should set boltzpay under mcpServers", () => {
    const configPath = join(testDir, "config.json");
    vi.spyOn(console, "error").mockImplementation(() => {});

    writeClaudeDesktopConfig(configPath, {}, SERVER_ENTRY);

    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.boltzpay).toEqual(SERVER_ENTRY);
  });

  it("should preserve existing mcpServers entries", () => {
    const configPath = join(testDir, "config.json");
    const existing = {
      mcpServers: { other: { command: "other-tool" } },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    writeClaudeDesktopConfig(configPath, existing, SERVER_ENTRY);

    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers.other).toEqual({ command: "other-tool" });
    expect(parsed.mcpServers.boltzpay).toEqual(SERVER_ENTRY);
  });

  it("should preserve non-mcpServers keys in config", () => {
    const configPath = join(testDir, "config.json");
    const existing = { customSetting: true };
    vi.spyOn(console, "error").mockImplementation(() => {});

    writeClaudeDesktopConfig(configPath, existing, SERVER_ENTRY);

    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.customSetting).toBe(true);
  });

  it("should create parent directories when they do not exist", () => {
    const deepPath = join(testDir, "deep", "nested", "config.json");
    expect(existsSync(join(testDir, "deep"))).toBe(false);
    vi.spyOn(console, "error").mockImplementation(() => {});

    writeClaudeDesktopConfig(deepPath, {}, SERVER_ENTRY);

    expect(existsSync(deepPath)).toBe(true);
  });

  it("should set restrictive file permissions on non-windows", () => {
    const configPath = join(testDir, "config.json");
    vi.spyOn(console, "error").mockImplementation(() => {});

    writeClaudeDesktopConfig(configPath, {}, SERVER_ENTRY);

    const { mode } = require("node:fs").statSync(configPath);
    const FILE_PERMISSION_MASK = 0o777;
    const EXPECTED_PERMISSIONS = 0o600;
    expect(mode & FILE_PERMISSION_MASK).toBe(EXPECTED_PERMISSIONS);
  });

  it("should end file content with newline", () => {
    const configPath = join(testDir, "config.json");
    vi.spyOn(console, "error").mockImplementation(() => {});

    writeClaudeDesktopConfig(configPath, {}, SERVER_ENTRY);

    const raw = readFileSync(configPath, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});
