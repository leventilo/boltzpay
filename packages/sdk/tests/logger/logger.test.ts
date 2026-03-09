import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger/logger";
import type { LogEntry } from "../../src/logger/logger";

describe("createLogger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should write warn and error when level is warn", () => {
    const logger = createLogger("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).not.toContain("DEBUG");
    expect(output).not.toContain("INFO");
    expect(output).toContain("[BoltzPay WARN] w");
    expect(output).toContain("[BoltzPay ERROR] e");
  });

  it("should write all levels when level is debug", () => {
    const logger = createLogger("debug");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(stderrSpy).toHaveBeenCalledTimes(4);
  });

  it("should write nothing when level is silent", () => {
    const logger = createLogger("silent");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("should format messages with level prefix", () => {
    const logger = createLogger("info");
    logger.info("test message");

    const output = stderrSpy.mock.calls[0]?.[0];
    expect(output).toBe("[BoltzPay INFO] test message\n");
  });

  it("should respect threshold for info level", () => {
    const logger = createLogger("info");
    logger.debug("hidden");
    logger.info("visible");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0]?.[0]).toContain("visible");
  });

  describe("backward compatibility", () => {
    it("createLogger with single arg defaults to text format", () => {
      const logger = createLogger("info");
      logger.info("hello");

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toBe("[BoltzPay INFO] hello\n");
    });

    it('createLogger("info", "text") produces text format', () => {
      const logger = createLogger("info", "text");
      logger.info("hello");

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toBe("[BoltzPay INFO] hello\n");
    });
  });

  describe("NDJSON format", () => {
    it('createLogger("info", "json") produces NDJSON with ts, level, msg', () => {
      const logger = createLogger("info", "json");
      logger.info("payment detected");

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.ts).toBeDefined();
      expect(parsed.level).toBe("info");
      expect(parsed.msg).toBe("payment detected");
    });

    it("NDJSON line ends with newline", () => {
      const logger = createLogger("info", "json");
      logger.info("test");

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output.endsWith("\n")).toBe(true);
    });

    it("ts field is a valid ISO timestamp", () => {
      const logger = createLogger("info", "json");
      logger.info("test");

      const parsed = JSON.parse(stderrSpy.mock.calls[0]?.[0] as string);
      const date = new Date(parsed.ts);
      expect(date.toISOString()).toBe(parsed.ts);
    });
  });

  describe("LogEntry structured fields", () => {
    it("includes LogEntry fields in JSON output", () => {
      const logger = createLogger("info", "json");
      const entry: LogEntry = { url: "https://x.com", amount: "$0.01" };
      logger.info("msg", entry);

      const parsed = JSON.parse(stderrSpy.mock.calls[0]?.[0] as string);
      expect(parsed.url).toBe("https://x.com");
      expect(parsed.amount).toBe("$0.01");
      expect(parsed.msg).toBe("msg");
    });

    it("LogEntry is optional in JSON mode", () => {
      const logger = createLogger("info", "json");
      logger.info("simple msg");

      const parsed = JSON.parse(stderrSpy.mock.calls[0]?.[0] as string);
      expect(parsed.msg).toBe("simple msg");
      expect(parsed.url).toBeUndefined();
    });

    it("LogEntry is ignored in text mode", () => {
      const logger = createLogger("info", "text");
      const entry: LogEntry = { url: "https://x.com" };
      logger.info("msg", entry);

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toBe("[BoltzPay INFO] msg\n");
      expect(output).not.toContain("https://x.com");
    });

    it("LogEntry is optional in text mode", () => {
      const logger = createLogger("info", "text");
      logger.info("msg");

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toBe("[BoltzPay INFO] msg\n");
    });
  });

  describe("level filtering in both formats", () => {
    it("filters debug at warn level in text mode", () => {
      const logger = createLogger("warn", "text");
      logger.debug("hidden");
      logger.warn("visible");

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]?.[0]).toContain("visible");
    });

    it("filters debug at warn level in json mode", () => {
      const logger = createLogger("warn", "json");
      logger.debug("hidden");
      logger.warn("visible");

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(stderrSpy.mock.calls[0]?.[0] as string);
      expect(parsed.msg).toBe("visible");
    });

    it("silent suppresses all in json mode", () => {
      const logger = createLogger("silent", "json");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });
});
