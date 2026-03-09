import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryAdapter } from "../../src/persistence/memory-adapter";
import { FileAdapter } from "../../src/persistence/file-adapter";
import type { StorageAdapter } from "../../src/persistence/storage-adapter";

// ---------- MemoryAdapter ----------

describe("MemoryAdapter", () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  it("implements StorageAdapter interface", () => {
    const sa: StorageAdapter = adapter;
    expect(sa).toBeDefined();
  });

  it("get() returns undefined for missing keys", async () => {
    expect(await adapter.get("nonexistent")).toBeUndefined();
  });

  it("set() then get() returns the stored value", async () => {
    await adapter.set("key1", "value1");
    expect(await adapter.get("key1")).toBe("value1");
  });

  it("set() overwrites existing value", async () => {
    await adapter.set("key1", "value1");
    await adapter.set("key1", "value2");
    expect(await adapter.get("key1")).toBe("value2");
  });

  it("delete() removes key, subsequent get() returns undefined", async () => {
    await adapter.set("key1", "value1");
    await adapter.delete("key1");
    expect(await adapter.get("key1")).toBeUndefined();
  });

  it("delete() is a no-op for missing keys", async () => {
    // Should not throw
    await adapter.delete("nonexistent");
  });

  it('keys("budget:") returns only keys starting with "budget:"', async () => {
    await adapter.set("budget:daily", "100");
    await adapter.set("budget:monthly", "1000");
    await adapter.set("history:pay_001", '{"id":"001"}');
    const budgetKeys = await adapter.keys("budget:");
    expect(budgetKeys).toEqual(
      expect.arrayContaining(["budget:daily", "budget:monthly"]),
    );
    expect(budgetKeys).toHaveLength(2);
  });

  it('keys("") returns all keys', async () => {
    await adapter.set("a", "1");
    await adapter.set("b", "2");
    await adapter.set("c", "3");
    const allKeys = await adapter.keys("");
    expect(allKeys).toHaveLength(3);
    expect(allKeys).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("all methods return Promises", () => {
    // Verify all returns are thenables (Promises)
    const getResult = adapter.get("x");
    const setResult = adapter.set("x", "v");
    const deleteResult = adapter.delete("x");
    const keysResult = adapter.keys("");
    expect(getResult).toBeInstanceOf(Promise);
    expect(setResult).toBeInstanceOf(Promise);
    expect(deleteResult).toBeInstanceOf(Promise);
    expect(keysResult).toBeInstanceOf(Promise);
  });
});

// ---------- FileAdapter ----------

describe("FileAdapter", () => {
  let tmpDir: string;
  let adapter: FileAdapter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "boltzpay-test-"));
    adapter = new FileAdapter({ dir: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("implements StorageAdapter interface", () => {
    const sa: StorageAdapter = adapter;
    expect(sa).toBeDefined();
  });

  it("set() creates file, get() reads it back", async () => {
    await adapter.set("key1", "value1");
    expect(await adapter.get("key1")).toBe("value1");
  });

  it("set() uses atomic write (no .tmp files remain)", async () => {
    await adapter.set("key1", "value1");
    const files = await readdir(tmpDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("get() returns undefined for missing keys", async () => {
    expect(await adapter.get("nonexistent")).toBeUndefined();
  });

  it("set() overwrites existing value", async () => {
    await adapter.set("key1", "first");
    await adapter.set("key1", "second");
    expect(await adapter.get("key1")).toBe("second");
  });

  it("delete() removes file, get() returns undefined after", async () => {
    await adapter.set("key1", "value1");
    await adapter.delete("key1");
    expect(await adapter.get("key1")).toBeUndefined();
  });

  it("delete() is a no-op for missing keys", async () => {
    // Should not throw
    await adapter.delete("nonexistent");
  });

  it("keys(prefix) returns matching keys, excludes .tmp files", async () => {
    await adapter.set("budget:daily", "100");
    await adapter.set("budget:monthly", "1000");
    await adapter.set("history:pay_001", '{"id":"001"}');

    const budgetKeys = await adapter.keys("budget:");
    expect(budgetKeys).toEqual(
      expect.arrayContaining(["budget:daily", "budget:monthly"]),
    );
    expect(budgetKeys).toHaveLength(2);
  });

  it('keys("") returns all keys', async () => {
    await adapter.set("a", "1");
    await adapter.set("b", "2");
    const allKeys = await adapter.keys("");
    expect(allKeys).toHaveLength(2);
    expect(allKeys).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("key encoding roundtrip: set with colon, keys returns original", async () => {
    await adapter.set("budget:state", '{"spent":0}');
    const keys = await adapter.keys("budget:");
    expect(keys).toEqual(["budget:state"]);
    expect(await adapter.get("budget:state")).toBe('{"spent":0}');
  });

  it("handles missing directory (creates with mkdir recursive)", async () => {
    const nestedDir = join(tmpDir, "nested", "deep");
    const nestedAdapter = new FileAdapter({ dir: nestedDir });
    await nestedAdapter.set("key1", "value1");
    expect(await nestedAdapter.get("key1")).toBe("value1");
  });

  it("all methods return Promises", async () => {
    const getResult = adapter.get("x");
    const setResult = adapter.set("x", "v");
    expect(getResult).toBeInstanceOf(Promise);
    expect(setResult).toBeInstanceOf(Promise);

    // Await set before calling delete/keys to avoid unhandled rejections
    // after afterEach removes the temp directory
    await setResult;
    await getResult;

    const deleteResult = adapter.delete("x");
    const keysResult = adapter.keys("");
    expect(deleteResult).toBeInstanceOf(Promise);
    expect(keysResult).toBeInstanceOf(Promise);
    await deleteResult;
    await keysResult;
  });
});
