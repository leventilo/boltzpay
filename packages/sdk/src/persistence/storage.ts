/**
 * Persistence utilities for BoltzPay SDK data files.
 * Stores data in ~/.boltzpay/ (configurable via persistence.directory).
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_DATA_DIR = ".boltzpay";

/** Resolve the data directory path. Defaults to ~/.boltzpay/. */
export function getDataDir(customDir?: string): string {
  return customDir ?? join(homedir(), DEFAULT_DATA_DIR);
}

/** Ensure a directory exists, creating it recursively if needed. */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Append a single line to a file (creates file + parent dirs if missing). */
export function appendLine(filePath: string, line: string): void {
  ensureDir(dirname(filePath));
  appendFileSync(filePath, `${line}\n`, "utf-8");
}

/** Read all non-empty lines from a file. Returns [] if file doesn't exist. */
export function readLines(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  return content.split("\n").filter((line) => line.trim() !== "");
}

/** Write a JSON object to a file atomically. */
export function writeJson(filePath: string, data: unknown): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/** Read a JSON file. Returns undefined if file doesn't exist or is corrupt. */
export function readJson<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    // Corrupt or unreadable file — treated as "no data" for graceful recovery
    return undefined;
  }
}

/** Overwrite a file with the given lines. */
export function writeLines(filePath: string, lines: string[]): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, lines.map((l) => `${l}\n`).join(""), "utf-8");
}
