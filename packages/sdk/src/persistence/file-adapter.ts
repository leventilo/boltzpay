import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { StorageAdapter } from "./storage-adapter";

const DEFAULT_DIR = ".boltzpay";

export class FileAdapter implements StorageAdapter {
  private readonly dir: string;

  constructor(opts?: { dir?: string }) {
    this.dir = opts?.dir ?? join(homedir(), DEFAULT_DIR);
  }

  async get(key: string): Promise<string | undefined> {
    try {
      return await readFile(this.keyToPath(key), "utf-8");
    } catch (err: unknown) {
      if (isEnoent(err)) return undefined;
      throw err;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const filePath = this.keyToPath(key);
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpPath, value, "utf-8");
      await rename(tmpPath, filePath);
    } catch (err: unknown) {
      try {
        await unlink(tmpPath);
      } catch {
        // Intent: tmp file cleanup is best-effort — OS will reclaim if unlink fails
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.keyToPath(key));
    } catch (err: unknown) {
      if (isEnoent(err)) return;
      throw err;
    }
  }

  async keys(prefix: string): Promise<string[]> {
    await mkdir(this.dir, { recursive: true });
    const entries = await readdir(this.dir);
    return entries
      .filter((name) => !name.endsWith(".tmp"))
      .map((name) => this.pathToKey(name))
      .filter((key) => key.startsWith(prefix));
  }

  private keyToPath(key: string): string {
    return join(this.dir, encodeURIComponent(key));
  }

  private pathToKey(filename: string): string {
    return decodeURIComponent(filename);
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}
