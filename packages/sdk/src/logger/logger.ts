const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
} as const;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogLevelConfig = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(level: LogLevelConfig): Logger {
  const threshold = LOG_LEVELS[level];

  function write(logLevel: LogLevel, msg: string): void {
    if (LOG_LEVELS[logLevel] >= threshold) {
      process.stderr.write(`[BoltzPay ${logLevel.toUpperCase()}] ${msg}\n`);
    }
  }

  return {
    debug(msg: string): void {
      write("debug", msg);
    },
    info(msg: string): void {
      write("info", msg);
    },
    warn(msg: string): void {
      write("warn", msg);
    },
    error(msg: string): void {
      write("error", msg);
    },
  };
}
