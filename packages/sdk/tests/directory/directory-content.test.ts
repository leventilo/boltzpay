import { describe, expect, it } from "vitest";

import {
  API_DIRECTORY,
  getDirectoryCategories,
} from "../../src/directory";

const VALID_PROTOCOLS = new Set(["x402", "l402"]);

const KNOWN_CATEGORIES = new Set([
  "crypto-data",
  "ai-llm",
  "utilities",
  "media",
  "demo",
  "research",
  "dev-tools",
]);

describe("API_DIRECTORY content validation", () => {
  it("should contain at least 23 verified entries", () => {
    expect(API_DIRECTORY.length).toBeGreaterThanOrEqual(23);
  });

  it("should have all required fields on every entry", () => {
    for (const entry of API_DIRECTORY) {
      expect(entry.name).toBeTypeOf("string");
      expect(entry.url).toBeTypeOf("string");
      expect(entry.protocol).toBeTypeOf("string");
      expect(entry.category).toBeTypeOf("string");
      expect(entry.description).toBeTypeOf("string");
      expect(entry.pricing).toBeTypeOf("string");
    }
  });

  it("should have valid HTTP(S) URLs on every entry", () => {
    for (const entry of API_DIRECTORY) {
      expect(entry.url).toMatch(/^https?:\/\//);
    }
  });

  it("should have valid protocols (x402 or l402)", () => {
    for (const entry of API_DIRECTORY) {
      expect(VALID_PROTOCOLS.has(entry.protocol)).toBe(true);
    }
  });

  it("should have categories from the known set", () => {
    for (const entry of API_DIRECTORY) {
      expect(KNOWN_CATEGORIES.has(entry.category)).toBe(true);
    }
  });

  it("should have no duplicate URLs", () => {
    const urls = API_DIRECTORY.map((e) => e.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });

  it("should have valid status values if present", () => {
    for (const entry of API_DIRECTORY) {
      if (entry.status !== undefined) {
        expect(["live", "testnet"]).toContain(entry.status);
      }
    }
  });
});

describe("getDirectoryCategories", () => {
  it("should return at least 3 distinct categories", () => {
    const categories = getDirectoryCategories();
    expect(categories.length).toBeGreaterThanOrEqual(3);
  });

  it("should return categories present in the directory", () => {
    const categories = getDirectoryCategories();
    const dirCategories = new Set(API_DIRECTORY.map((e) => e.category));
    for (const cat of categories) {
      expect(dirCategories.has(cat)).toBe(true);
    }
  });

  it("should return unique values", () => {
    const categories = getDirectoryCategories();
    expect(new Set(categories).size).toBe(categories.length);
  });
});
