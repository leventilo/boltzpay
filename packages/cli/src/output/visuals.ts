import chalk from "chalk";

const BRAND = chalk.bold.cyan;
const ACCENT = chalk.cyan;
const MUTED = chalk.gray;
const SEPARATOR_CHAR = "─";

const DEFAULT_HEADER_WIDTH = 56;
const DEFAULT_BOX_WIDTH = 54;
const DEFAULT_BAR_WIDTH = 20;
const DEFAULT_HEALTH_BAR_WIDTH = 30;
const DEFAULT_PROGRESS_WIDTH = 25;

const BAR_THRESHOLD_CRITICAL = 0.9;
const BAR_THRESHOLD_WARNING = 0.75;
const BAR_CORE_EDGE_MIN = 2;
const PERCENTAGE_MULTIPLIER = 100;

const SPARK_CHARS = "▁▂▃▄▅▆▇█";
const SPARK_MID_INDEX = 3;
const SPARK_MAX_INDEX = 7;

const LATENCY_FAST_THRESHOLD_MS = 300;
const LATENCY_MODERATE_THRESHOLD_MS = 1000;
const LATENCY_MAX_MS = 2000;
const LATENCY_BAR_WIDTH = 5;

const HEADER_PREFIX_LENGTH = 4;
const HEADER_SUFFIX_SPACING = 1;
const BOX_PADDING = 2;

export function renderHeader(title: string, width = DEFAULT_HEADER_WIDTH): string {
  const prefix = `${ACCENT("───")} ${BRAND(title)} `;
  const visibleLen = HEADER_PREFIX_LENGTH + title.length + HEADER_SUFFIX_SPACING;
  const remaining = Math.max(0, width - visibleLen);
  return prefix + ACCENT(SEPARATOR_CHAR.repeat(remaining));
}

export function renderBox(lines: readonly string[], width = DEFAULT_BOX_WIDTH): string {
  const top = ACCENT("  ┌" + SEPARATOR_CHAR.repeat(width) + "┐");
  const bottom = ACCENT("  └" + SEPARATOR_CHAR.repeat(width) + "┘");
  const rows = lines.map((line) => {
    const visible = stripAnsi(line);
    const pad = Math.max(0, width - BOX_PADDING - visible.length);
    return ACCENT("  │") + " " + line + " ".repeat(pad) + " " + ACCENT("│");
  });
  return [top, ...rows, bottom].join("\n");
}

export function renderEmptyState(
  icon: string,
  message: string,
  hint?: string,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${icon}  ${chalk.white(message)}`);
  if (hint) {
    lines.push(`      ${MUTED(hint)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderBar(ratio: number, width = DEFAULT_BAR_WIDTH): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  const empty = width - filled;

  const colorFn = barColorForRatio(clamped);

  let filledStr: string;
  if (filled <= BAR_CORE_EDGE_MIN) {
    filledStr = colorFn("█".repeat(filled));
  } else {
    const core = filled - 1;
    filledStr = colorFn("█".repeat(core) + "▓");
  }

  const emptyStr = chalk.gray("░".repeat(empty));
  const pct = `${Math.round(clamped * PERCENTAGE_MULTIPLIER)}%`;

  return `${filledStr}${emptyStr} ${colorFn(pct)}`;
}

export function renderSparkline(values: readonly number[]): string {
  if (values.length === 0) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    return ACCENT(SPARK_CHARS[SPARK_MID_INDEX]!.repeat(values.length));
  }

  const range = max - min;
  const chars = values.map((v) => {
    const index = Math.round(((v - min) / range) * SPARK_MAX_INDEX);
    return SPARK_CHARS[index]!;
  });

  return ACCENT(chars.join(""));
}

export function renderHealthBar(
  counts: { healthy: number; degraded: number; dead: number },
  width = DEFAULT_HEALTH_BAR_WIDTH,
): string {
  const total = counts.healthy + counts.degraded + counts.dead;

  if (total === 0) {
    return chalk.gray("░".repeat(width));
  }

  let healthyW = Math.round((counts.healthy / total) * width);
  let degradedW = Math.round((counts.degraded / total) * width);
  let deadW = Math.round((counts.dead / total) * width);

  const sum = healthyW + degradedW + deadW;
  const diff = width - sum;
  if (diff !== 0) {
    if (healthyW >= degradedW && healthyW >= deadW) {
      healthyW += diff;
    } else if (degradedW >= deadW) {
      degradedW += diff;
    } else {
      deadW += diff;
    }
  }

  const bar =
    chalk.green("█".repeat(healthyW)) +
    chalk.yellow("█".repeat(degradedW)) +
    chalk.red("█".repeat(deadW));

  const legend: string[] = [];
  if (counts.healthy > 0)
    legend.push(chalk.green(`■ ${counts.healthy} healthy`));
  if (counts.degraded > 0)
    legend.push(chalk.yellow(`■ ${counts.degraded} degraded`));
  if (counts.dead > 0) legend.push(chalk.red(`■ ${counts.dead} dead`));

  return `  ${bar}\n  ${legend.join("  ")}`;
}

export function renderLatencyIndicator(ms: number): string {
  const colorFn = latencyColorForMs(ms);
  const ratio = Math.min(1, ms / LATENCY_MAX_MS);
  const filled = Math.round(ratio * LATENCY_BAR_WIDTH);
  const empty = LATENCY_BAR_WIDTH - filled;
  const miniBar = colorFn("█".repeat(filled)) + chalk.gray("░".repeat(empty));
  return `${miniBar} ${colorFn(`${ms}ms`)}`;
}

export function renderProgress(
  done: number,
  total: number,
  width = DEFAULT_PROGRESS_WIDTH,
  label = "Scanning",
): string {
  const ratio = total > 0 ? done / total : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const pct = Math.round(ratio * PERCENTAGE_MULTIPLIER);

  const bar = chalk.cyan("█".repeat(filled)) + chalk.gray("░".repeat(empty));
  const counter = MUTED(`${done}/${total}`);

  return `\r  ${bar} ${chalk.white(`${pct}%`)} ${counter} ${MUTED(label)}`;
}

export const TABLE_STYLE = {
  head: ["cyan", "bold"] as string[],
  border: ["gray"] as string[],
};

export const TABLE_COMPACT_CHARS = {
  top: "",
  "top-mid": "",
  "top-left": "",
  "top-right": "",
  bottom: "",
  "bottom-mid": "",
  "bottom-left": "",
  "bottom-right": "",
  left: "  ",
  "left-mid": "  ",
  mid: "─",
  "mid-mid": "┼",
  right: "",
  "right-mid": "",
  middle: " │ ",
};

type ColorFn = (text: string) => string;

function barColorForRatio(ratio: number): ColorFn {
  if (ratio > BAR_THRESHOLD_CRITICAL) return chalk.red;
  if (ratio >= BAR_THRESHOLD_WARNING) return chalk.yellow;
  return chalk.green;
}

function latencyColorForMs(ms: number): ColorFn {
  if (ms < LATENCY_FAST_THRESHOLD_MS) return chalk.green;
  if (ms < LATENCY_MODERATE_THRESHOLD_MS) return chalk.yellow;
  return chalk.red;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export { BRAND, ACCENT, MUTED };
