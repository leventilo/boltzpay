import { describe, expect, it } from "vitest";

import {
  renderBar,
  renderEmptyState,
  renderHeader,
  renderHealthBar,
  renderLatencyIndicator,
  renderProgress,
  renderSparkline,
} from "../../src/output/visuals.js";

/**
 * Strip ANSI escape codes for content assertions.
 */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI strip
  return str.replace(/\x1B\[\d+[;\d]*m/g, "");
}

describe("renderBar", () => {
  it("should produce an all-empty bar for ratio 0", () => {
    const result = stripAnsi(renderBar(0, 20));
    expect(result).toContain("░".repeat(20));
    expect(result).toContain("0%");
  });

  it("should produce an all-full bar for ratio 1", () => {
    const result = stripAnsi(renderBar(1, 20));
    expect(result).toContain("100%");
    // Should have filled chars (█ and/or ▓)
    const blocks = (result.match(/[█▓]/g) ?? []).length;
    expect(blocks).toBe(20);
  });

  it("should produce a half-filled bar for ratio 0.5", () => {
    const result = stripAnsi(renderBar(0.5, 20));
    expect(result).toContain("50%");
    const filled = (result.match(/[█▓]/g) ?? []).length;
    expect(filled).toBe(10);
  });

  it("should clamp values below 0 to 0", () => {
    const result = stripAnsi(renderBar(-0.5, 10));
    expect(result).toContain("░".repeat(10));
    expect(result).toContain("0%");
  });

  it("should clamp values above 1 to 1", () => {
    const result = stripAnsi(renderBar(1.5, 10));
    expect(result).toContain("100%");
  });

  it("should respect custom width", () => {
    const result = stripAnsi(renderBar(0.5, 30));
    const filled = (result.match(/[█▓]/g) ?? []).length;
    const empty = (result.match(/░/g) ?? []).length;
    expect(filled + empty).toBe(30);
  });

  it("should use default width of 20", () => {
    const result = stripAnsi(renderBar(0.5));
    const filled = (result.match(/[█▓]/g) ?? []).length;
    const empty = (result.match(/░/g) ?? []).length;
    expect(filled + empty).toBe(20);
  });
});

describe("renderSparkline", () => {
  it("should return empty string for empty array", () => {
    const result = renderSparkline([]);
    expect(result).toBe("");
  });

  it("should produce sparkline characters for ascending values", () => {
    const result = stripAnsi(renderSparkline([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(result).toHaveLength(8);
    expect(result[0]).toBe("▁");
    expect(result[7]).toBe("█");
  });

  it("should use mid-level char for all-same values", () => {
    const result = stripAnsi(renderSparkline([5, 5, 5, 5]));
    expect(result).toHaveLength(4);
    expect(result).toBe("▄▄▄▄");
  });

  it("should handle single value", () => {
    const result = stripAnsi(renderSparkline([42]));
    expect(result).toHaveLength(1);
    expect(result).toBe("▄");
  });

  it("should map relative values to spark chars", () => {
    const result = stripAnsi(renderSparkline([1, 3, 7, 2, 5]));
    expect(result).toHaveLength(5);
    const validChars = "▁▂▃▄▅▆▇█";
    for (const char of result) {
      expect(validChars).toContain(char);
    }
  });
});

describe("renderHealthBar", () => {
  it("should produce a segmented bar for mixed counts", () => {
    const result = stripAnsi(
      renderHealthBar({ healthy: 5, degraded: 2, dead: 1 }, 20),
    );
    const blocks = (result.match(/█/g) ?? []).length;
    expect(blocks).toBe(20);
    // Should include legend
    expect(result).toContain("healthy");
    expect(result).toContain("degraded");
    expect(result).toContain("dead");
  });

  it("should produce a dim bar for all-zero counts", () => {
    const result = stripAnsi(
      renderHealthBar({ healthy: 0, degraded: 0, dead: 0 }, 20),
    );
    expect(result).toContain("░".repeat(20));
  });

  it("should produce all-green bar when only healthy", () => {
    const result = stripAnsi(
      renderHealthBar({ healthy: 10, degraded: 0, dead: 0 }, 20),
    );
    expect(result).toContain("█".repeat(20));
    expect(result).toContain("10 healthy");
  });

  it("should handle single-category dead", () => {
    const result = stripAnsi(
      renderHealthBar({ healthy: 0, degraded: 0, dead: 5 }, 10),
    );
    expect(result).toContain("█".repeat(10));
    expect(result).toContain("5 dead");
  });

  it("should use default width of 30", () => {
    const result = stripAnsi(
      renderHealthBar({ healthy: 5, degraded: 3, dead: 2 }),
    );
    const blocks = (result.match(/█/g) ?? []).length;
    expect(blocks).toBe(30);
  });
});

describe("renderLatencyIndicator", () => {
  it("should show latency value for fast latency (< 300ms)", () => {
    const result = renderLatencyIndicator(50);
    const stripped = stripAnsi(result);
    expect(stripped).toContain("50ms");
    // Should have filled blocks
    expect(stripped).toMatch(/[█░]/);
  });

  it("should show latency value at boundary (299ms)", () => {
    const result = renderLatencyIndicator(299);
    const stripped = stripAnsi(result);
    expect(stripped).toContain("299ms");
  });

  it("should show latency value for medium latency (300-999ms)", () => {
    const result = renderLatencyIndicator(500);
    const stripped = stripAnsi(result);
    expect(stripped).toContain("500ms");
  });

  it("should show latency value for slow latency (>= 1000ms)", () => {
    const result = renderLatencyIndicator(2000);
    const stripped = stripAnsi(result);
    expect(stripped).toContain("2000ms");
  });

  it("should show latency value at boundary (1000ms)", () => {
    const result = renderLatencyIndicator(1000);
    const stripped = stripAnsi(result);
    expect(stripped).toContain("1000ms");
  });
});

describe("renderHeader", () => {
  it("should include title text", () => {
    const result = stripAnsi(renderHeader("Test Title"));
    expect(result).toContain("Test Title");
    expect(result).toContain("───");
  });

  it("should respect custom width", () => {
    const result = stripAnsi(renderHeader("X", 40));
    // Should have separator chars filling the width
    const dashes = (result.match(/─/g) ?? []).length;
    expect(dashes).toBeGreaterThan(30);
  });
});

describe("renderEmptyState", () => {
  it("should include icon and message", () => {
    const result = stripAnsi(renderEmptyState("X", "Nothing here"));
    expect(result).toContain("X");
    expect(result).toContain("Nothing here");
  });

  it("should include hint when provided", () => {
    const result = stripAnsi(renderEmptyState("!", "Empty", "Try again"));
    expect(result).toContain("Try again");
  });

  it("should not include hint when not provided", () => {
    const result = stripAnsi(renderEmptyState("!", "Empty"));
    expect(result).toContain("Empty");
  });
});

describe("renderProgress", () => {
  it("should show percentage and counter", () => {
    const result = stripAnsi(renderProgress(50, 100));
    expect(result).toContain("50%");
    expect(result).toContain("50/100");
  });

  it("should show 0% at start", () => {
    const result = stripAnsi(renderProgress(0, 200));
    expect(result).toContain("0%");
    expect(result).toContain("0/200");
  });

  it("should show 100% at end", () => {
    const result = stripAnsi(renderProgress(10, 10));
    expect(result).toContain("100%");
    expect(result).toContain("10/10");
  });
});
