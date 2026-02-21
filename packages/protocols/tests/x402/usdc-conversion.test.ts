import { describe, expect, it } from "vitest";
import {
  centsToUsdcAtomic,
  usdcAtomicToCents,
} from "../../src/x402/usdc-conversion";

describe("usdcAtomicToCents", () => {
  it("should convert 1 USDC (1,000,000 atomic) to 100 cents", () => {
    expect(usdcAtomicToCents(1_000_000n)).toBe(100n);
  });

  it("should convert 10,000 atomic to 1 cent", () => {
    expect(usdcAtomicToCents(10_000n)).toBe(1n);
  });

  it("should round up for partial cents", () => {
    expect(usdcAtomicToCents(10_001n)).toBe(2n);
    expect(usdcAtomicToCents(19_999n)).toBe(2n);
  });

  it("should return minimum 1 cent for small amounts", () => {
    expect(usdcAtomicToCents(1n)).toBe(1n);
    expect(usdcAtomicToCents(9_999n)).toBe(1n);
  });

  it("should return 0 cents for zero atomic units", () => {
    expect(usdcAtomicToCents(0n)).toBe(0n);
  });

  it("should handle large amounts", () => {
    expect(usdcAtomicToCents(100_000_000n)).toBe(10_000n);
  });

  it("should throw on negative atomic units", () => {
    expect(() => usdcAtomicToCents(-1n)).toThrow(
      "Atomic units cannot be negative",
    );
  });
});

describe("centsToUsdcAtomic", () => {
  it("should convert 100 cents to 1,000,000 atomic", () => {
    expect(centsToUsdcAtomic(100n)).toBe(1_000_000n);
  });

  it("should convert 1 cent to 10,000 atomic", () => {
    expect(centsToUsdcAtomic(1n)).toBe(10_000n);
  });

  it("should handle zero", () => {
    expect(centsToUsdcAtomic(0n)).toBe(0n);
  });

  it("should handle large amounts", () => {
    expect(centsToUsdcAtomic(10_000n)).toBe(100_000_000n);
  });

  it("should throw on negative cents", () => {
    expect(() => centsToUsdcAtomic(-1n)).toThrow("Cents cannot be negative");
  });
});
