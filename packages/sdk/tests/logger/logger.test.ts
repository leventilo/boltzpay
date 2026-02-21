import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger/logger";

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
});
