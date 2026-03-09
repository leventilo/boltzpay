const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
} as const;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogLevelConfig = "debug" | "info" | "warn" | "error" | "silent";

export type LogFormat = "text" | "json";

export interface LogEntry {
  url?: string;
  protocol?: string;
  amount?: string;
  duration?: number;
  status?: "success" | "error" | "skipped" | "free";
  error?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, entry?: LogEntry): void;
  info(msg: string, entry?: LogEntry): void;
  warn(msg: string, entry?: LogEntry): void;
  error(msg: string, entry?: LogEntry): void;
}

export function createLogger(
  level: LogLevelConfig,
  format: LogFormat = "text",
): Logger {
  const threshold = LOG_LEVELS[level];

  function write(logLevel: LogLevel, msg: string, entry?: LogEntry): void {
    if (LOG_LEVELS[logLevel] >= threshold) {
      if (format === "json") {
        process.stderr.write(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: logLevel,
            msg,
            ...entry,
          }) + "\n",
        );
      } else {
        process.stderr.write(
          `[BoltzPay ${logLevel.toUpperCase()}] ${msg}\n`,
        );
      }
    }
  }

  return {
    debug(msg: string, entry?: LogEntry): void {
      write("debug", msg, entry);
    },
    info(msg: string, entry?: LogEntry): void {
      write("info", msg, entry);
    },
    warn(msg: string, entry?: LogEntry): void {
      write("warn", msg, entry);
    },
    error(msg: string, entry?: LogEntry): void {
      write("error", msg, entry);
    },
  };
}
