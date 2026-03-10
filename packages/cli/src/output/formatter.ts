import type {
  BoltzPayResponse,
  BudgetState,
  DiagnoseResult,
  DiscoveredEntry,
  EndpointHealth,
  LightningStatus,
  PaymentRecord,
  WalletStatus,
} from "@boltzpay/sdk";
import { isTestnet, Money, networkToShortName } from "@boltzpay/sdk";
import chalk from "chalk";
import Table from "cli-table3";

import {
  ACCENT,
  BRAND,
  MUTED,
  renderBar,
  renderBox,
  renderEmptyState,
  renderHeader,
  renderHealthBar,
  renderLatencyIndicator,
  renderSparkline,
  TABLE_STYLE,
} from "./visuals.js";

const MAX_BODY_LENGTH = 5000;
const JSON_INDENT = 2;
const MAX_URL_DISPLAY_LENGTH = 40;
const ELLIPSIS = "...";
const ZERO_AMOUNT_DISPLAY = "$0.00";
const BUDGET_BAR_WIDTH = 25;
const SUMMARY_BAR_WIDTH = 30;
const NAME_TRUNCATE_LENGTH = 34;
const NAME_COLUMN_MAX = 30;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 300;
const HTTP_CLIENT_ERROR_MIN = 400;

interface FetchFormatOptions {
  readonly response: BoltzPayResponse;
  readonly body: string;
  readonly duration: number;
  readonly url: string;
  readonly detail: "normal" | "verbose";
}

export function formatFetchResult(options: FetchFormatOptions): string {
  const { response, body, duration, url, detail } = options;
  const lines: string[] = [];

  if (response.payment) {
    lines.push(renderHeader("Payment"));
    lines.push(
      renderBox([
        `Protocol:  ${chalk.white(response.payment.protocol)}`,
        `Amount:    ${chalk.yellow(response.payment.amount.toDisplayString())}`,
        ...(response.payment.txHash
          ? [`Tx Hash:   ${MUTED(response.payment.txHash)}`]
          : []),
      ]).trimStart(),
    );
    lines.push("");
  }

  lines.push(renderHeader("Response"));
  const responseLines = [
    `URL:       ${chalk.white(url)}`,
    `Status:    ${formatStatusCode(response.status)}`,
    `Type:      ${chalk.white(response.headers["content-type"] ?? "unknown")}`,
  ];
  if (detail === "verbose") {
    responseLines.push(`Duration:  ${renderLatencyIndicator(duration)}`);
  }
  lines.push(renderBox(responseLines).trimStart());

  if (detail === "verbose") {
    lines.push("");
    lines.push(renderHeader("Headers"));
    const headerLines = Object.entries(response.headers).map(
      ([key, value]) => `${MUTED(key)}: ${chalk.white(String(value))}`,
    );
    lines.push(renderBox(headerLines).trimStart());
  }

  lines.push("");
  lines.push(renderHeader("Body"));

  const formatted = prettyPrintJson(body);
  if (formatted.length > MAX_BODY_LENGTH) {
    lines.push(formatted.slice(0, MAX_BODY_LENGTH));
    lines.push(MUTED(`...truncated (${formatted.length} chars total)`));
  } else {
    lines.push(formatted);
  }

  return lines.join("\n");
}

function prettyPrintJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, JSON_INDENT);
  } catch {
    return raw;
  }
}

interface AcceptOptionDisplay {
  readonly chain: string;
  readonly network: string;
  readonly amount: string;
}

interface QuoteData {
  readonly protocol: string;
  readonly amount: string;
  readonly network: string | undefined;
  readonly alternatives?: readonly AcceptOptionDisplay[];
}

export function formatQuoteResult(quote: QuoteData): string {
  const lines: string[] = [];

  lines.push(renderHeader("Quote"));
  const quoteLines = [
    `Protocol:  ${chalk.white(quote.protocol)}`,
    `Amount:    ${chalk.yellow(quote.amount)}`,
  ];
  if (quote.network) {
    const name = networkToShortName(quote.network);
    const testnetBadge = isTestnet(quote.network)
      ? chalk.yellow(" \u26A0 TESTNET")
      : "";
    quoteLines.push(
      `Network:   ${chalk.white(name)} (${quote.network})${testnetBadge}`,
    );
  }
  lines.push(renderBox(quoteLines).trimStart());

  if (quote.alternatives && quote.alternatives.length > 0) {
    lines.push("");
    lines.push(`  ${BRAND("Alternatives:")}`);
    for (const alt of quote.alternatives) {
      lines.push(
        `    ${ACCENT("\u25B8")} ${chalk.white(alt.network)} (${alt.chain}) \u2014 ${chalk.yellow(alt.amount)}`,
      );
    }
  }

  return lines.join("\n");
}

export function formatBudgetResult(budget: BudgetState): string {
  const hasLimits =
    budget.dailyLimit || budget.monthlyLimit || budget.perTransactionLimit;

  if (!hasLimits) {
    return renderEmptyState(
      chalk.green("\u2714"),
      "No budget limits configured",
      "All payments allowed. Use sdk.configure({ budget: { ... } }) to set limits.",
    );
  }

  const lines: string[] = [];
  lines.push(renderHeader("Budget Status"));
  lines.push("");

  if (budget.dailyLimit) {
    const spent = budget.dailySpent.toDisplayString();
    const limit = budget.dailyLimit.toDisplayString();
    const remaining = budget.dailyRemaining
      ? budget.dailyRemaining.toDisplayString()
      : ZERO_AMOUNT_DISPLAY;
    const dailyRatio =
      Number(budget.dailySpent.cents) / Number(budget.dailyLimit.cents);
    lines.push(`  ${BRAND("Daily")}`);
    lines.push(
      `    ${renderBar(dailyRatio, BUDGET_BAR_WIDTH)}  ${chalk.white(spent)} / ${chalk.white(limit)}`,
    );
    lines.push(`    Remaining: ${formatRemaining(remaining)}`);
    lines.push("");
  }

  if (budget.monthlyLimit) {
    const spent = budget.monthlySpent.toDisplayString();
    const limit = budget.monthlyLimit.toDisplayString();
    const remaining = budget.monthlyRemaining
      ? budget.monthlyRemaining.toDisplayString()
      : ZERO_AMOUNT_DISPLAY;
    const monthlyRatio =
      Number(budget.monthlySpent.cents) / Number(budget.monthlyLimit.cents);
    lines.push(`  ${BRAND("Monthly")}`);
    lines.push(
      `    ${renderBar(monthlyRatio, BUDGET_BAR_WIDTH)}  ${chalk.white(spent)} / ${chalk.white(limit)}`,
    );
    lines.push(`    Remaining: ${formatRemaining(remaining)}`);
    lines.push("");
  }

  if (budget.perTransactionLimit) {
    lines.push(
      `  ${BRAND("Per Transaction")}:  max ${chalk.yellow(budget.perTransactionLimit.toDisplayString())}`,
    );
  }

  return lines.join("\n");
}

export function formatHistoryResult(records: readonly PaymentRecord[]): string {
  if (records.length === 0) {
    return renderEmptyState(
      ACCENT("\u25CB"),
      "No payments made yet",
      "Use boltzpay fetch <url> to make your first payment.",
    );
  }

  const lines: string[] = [];
  lines.push(renderHeader("Payment History"));
  lines.push("");

  const table = new Table({
    head: ["Date", "Protocol", "Amount", "Chain", "URL"],
    style: TABLE_STYLE,
    colWidths: [22, 10, 12, 10, 42],
  });

  const chainTotals = new Map<string, bigint>();

  for (const record of records) {
    const date = record.timestamp.toISOString().slice(0, 19).replace("T", " ");
    const chain = networkToShortName(record.network);
    const url = truncateUrl(record.url, MAX_URL_DISPLAY_LENGTH);
    table.push([
      chalk.white(date),
      chalk.white(record.protocol),
      chalk.yellow(record.amount.toDisplayString()),
      chalk.white(chain),
      ACCENT(url),
    ]);
    const existing = chainTotals.get(chain) ?? 0n;
    chainTotals.set(chain, existing + record.amount.cents);
  }

  lines.push(table.toString());

  const amounts = records.map((r) => Number(r.amount.cents));
  const sparkline = renderSparkline(amounts);
  if (sparkline) {
    lines.push(`  Spending trend: ${sparkline}`);
  }

  lines.push("");
  lines.push(`  ${chalk.white(`${records.length} payment(s)`)} total`);

  if (chainTotals.size > 0) {
    const totalsStr = [...chainTotals.entries()]
      .map(
        ([chain, cents]) =>
          `${chalk.white(chain)} ${chalk.yellow(Money.fromCents(cents).toDisplayString())}`,
      )
      .join("  \u00B7  ");
    lines.push(`  By chain: ${totalsStr}`);
  }

  return lines.join("\n");
}

export function formatDiscoverResult(
  entries: readonly DiscoveredEntry[],
): string {
  if (entries.length === 0) {
    return renderEmptyState(
      ACCENT("\u25CB"),
      "No matching endpoints found",
      "Check your network connection or try again later.",
    );
  }

  const counts = { live: 0, free: 0, offline: 0, error: 0 };
  const lines: string[] = [];
  lines.push(renderHeader("Compatible Paid API Endpoints"));
  lines.push("");

  const table = new Table({
    head: ["Name", "Status", "Price", "Category"],
    style: TABLE_STYLE,
    colWidths: [36, 16, 12, 14],
    wordWrap: true,
  });

  for (const entry of entries) {
    counts[entry.live.status]++;
    const badge = formatStatusBadge(entry);
    const price = formatStatusPrice(entry);
    table.push([
      chalk.white(truncateUrl(entry.name, NAME_TRUNCATE_LENGTH)),
      badge,
      price,
      MUTED(entry.category),
    ]);
  }

  lines.push(table.toString());
  lines.push("");

  const total = entries.length;
  const liveRatio = counts.live / total;
  const freeRatio = counts.free / total;

  const liveW = Math.round(liveRatio * SUMMARY_BAR_WIDTH);
  const freeW = Math.round(freeRatio * SUMMARY_BAR_WIDTH);
  const offW = SUMMARY_BAR_WIDTH - liveW - freeW;
  const summaryBar =
    chalk.green("█".repeat(liveW)) +
    chalk.blue("█".repeat(freeW)) +
    chalk.red("█".repeat(Math.max(0, offW)));

  lines.push(`  ${summaryBar}`);

  const parts: string[] = [];
  if (counts.live > 0) parts.push(chalk.green(`■ ${counts.live} live`));
  if (counts.free > 0) parts.push(chalk.blue(`■ ${counts.free} free`));
  if (counts.offline > 0)
    parts.push(chalk.yellow(`■ ${counts.offline} offline`));
  if (counts.error > 0) parts.push(chalk.red(`■ ${counts.error} error`));
  lines.push(`  ${parts.join("  ")}  ${MUTED(`(${total} total)`)}`);

  return lines.join("\n");
}

function formatStatusBadge(entry: DiscoveredEntry): string {
  switch (entry.live.status) {
    case "live":
      return chalk.green(`\u25CF LIVE`) + MUTED(` ${entry.live.protocol}`);
    case "free":
      return chalk.blue("\u25CF FREE");
    case "offline":
      return chalk.yellow("\u25CF OFFLINE");
    case "error":
      return chalk.red("\u25CF ERROR");
    default: {
      const _exhaustive: never = entry.live;
      return _exhaustive;
    }
  }
}

function formatStatusPrice(entry: DiscoveredEntry): string {
  switch (entry.live.status) {
    case "live":
      return chalk.yellow(entry.live.livePrice);
    case "free":
      return chalk.blue("Free");
    case "offline":
      return chalk.yellow(entry.pricing);
    case "error":
      return chalk.yellow(entry.pricing);
    default: {
      const _exhaustive: never = entry.live;
      return _exhaustive;
    }
  }
}

function formatConfigurationSection(status: WalletStatus): string[] {
  const lines: string[] = [];
  const testnetBadge = status.isTestnet
    ? chalk.yellow(" (testnet)")
    : chalk.green(" (mainnet)");
  lines.push(`  ${BRAND("Configuration")}`);
  lines.push(`    Network:    ${chalk.white(status.network)}${testnetBadge}`);
  lines.push(`    Protocols:  ${chalk.white(status.protocols.join(", "))}`);
  lines.push(
    `    Can pay:    ${status.canPay ? chalk.green("Yes") : chalk.red("No")}`,
  );
  return lines;
}

function formatCredentialsSection(status: WalletStatus): string[] {
  const lines: string[] = [];
  lines.push(`  ${BRAND("Coinbase CDP")}`);
  if (status.credentials.coinbase.configured) {
    const hint = status.credentials.coinbase.keyHint
      ? ` (${status.credentials.coinbase.keyHint})`
      : "";
    lines.push(`    API Key:    ${chalk.green("Configured")}${hint}`);
  } else {
    lines.push(`    API Key:    ${chalk.red("Not configured")}`);
  }
  return lines;
}

function formatConnectionSection(status: WalletStatus): string[] {
  const lines: string[] = [];
  if (status.connection.status === "connected") {
    lines.push(
      `    Connection: ${chalk.green("Connected")} (${renderLatencyIndicator(status.connection.latencyMs ?? 0)})`,
    );
  } else if (status.connection.status === "error") {
    lines.push(
      `    Connection: ${chalk.red("Failed")} (${chalk.red(status.connection.error ?? "Unknown")})`,
    );
  } else {
    lines.push(`    Connection: ${MUTED("Skipped")}`);
  }

  if (!status.credentials.coinbase.configured) {
    lines.push("");
    lines.push(
      chalk.yellow("  Set COINBASE_API_KEY_ID, COINBASE_API_KEY_SECRET, and"),
    );
    lines.push(
      chalk.yellow(
        "  COINBASE_WALLET_SECRET environment variables to enable payments.",
      ),
    );
  }
  return lines;
}

function formatAccountsSection(status: WalletStatus): string[] {
  if (status.connection.status !== "connected") return [];

  const lines: string[] = [];
  lines.push(`  ${BRAND("Accounts")}`);
  if (status.accounts.evm) {
    const balanceStr = status.accounts.evm.balance
      ? chalk.green(status.accounts.evm.balance.toDisplayString())
      : MUTED("unknown");
    lines.push(
      `    EVM:        ${chalk.white(status.accounts.evm.address)}    ${balanceStr} USDC`,
    );
  } else {
    lines.push(`    EVM:        ${MUTED("Not provisioned")}`);
  }
  if (status.accounts.svm) {
    const balanceStr = status.accounts.svm.balance
      ? chalk.green(status.accounts.svm.balance.toDisplayString())
      : MUTED("unknown");
    lines.push(
      `    Solana:     ${chalk.white(status.accounts.svm.address)}    ${balanceStr} USDC`,
    );
  } else {
    lines.push(`    Solana:     ${MUTED("Not provisioned")}`);
  }
  return lines;
}

function formatLightningSection(
  lightning: LightningStatus | undefined,
): string[] {
  if (!lightning) return [];

  const lines: string[] = [];
  lines.push(`  ${BRAND("Lightning (NWC)")}`);

  if (lightning.connection.status === "connected") {
    lines.push(
      `    Connection: ${chalk.green("Connected")} (${renderLatencyIndicator(lightning.connection.latencyMs ?? 0)})`,
    );
    if (lightning.balance) {
      lines.push(`    Balance:    ${chalk.green(lightning.balance.display)}`);
    }
  } else if (lightning.connection.status === "error") {
    lines.push(
      `    Connection: ${chalk.red("Failed")} (${chalk.red(lightning.connection.error ?? "Unknown")})`,
    );
  } else {
    lines.push(`    Connection: ${MUTED("Skipped")}`);
  }

  return lines;
}

function formatBudgetSection(status: WalletStatus): string[] {
  const lines: string[] = [];
  lines.push(`  ${BRAND("Budget")}`);
  const hasLimits =
    status.budget.dailyLimit ||
    status.budget.monthlyLimit ||
    status.budget.perTransactionLimit;
  if (!hasLimits) {
    lines.push(`    ${MUTED("No limits configured")}`);
    return lines;
  }

  if (status.budget.dailyLimit) {
    const remaining =
      status.budget.dailyRemaining?.toDisplayString() ?? ZERO_AMOUNT_DISPLAY;
    lines.push(
      `    Daily:      ${chalk.white(status.budget.dailySpent.toDisplayString())} / ${chalk.white(status.budget.dailyLimit.toDisplayString())} (${remaining} remaining)`,
    );
  }
  if (status.budget.monthlyLimit) {
    const remaining =
      status.budget.monthlyRemaining?.toDisplayString() ?? ZERO_AMOUNT_DISPLAY;
    lines.push(
      `    Monthly:    ${chalk.white(status.budget.monthlySpent.toDisplayString())} / ${chalk.white(status.budget.monthlyLimit.toDisplayString())} (${remaining} remaining)`,
    );
  }
  if (status.budget.perTransactionLimit) {
    lines.push(
      `    Per tx:     max ${chalk.yellow(status.budget.perTransactionLimit.toDisplayString())}`,
    );
  }
  return lines;
}

export function formatWalletStatus(status: WalletStatus): string {
  const lines: string[] = [];

  lines.push(renderHeader("Wallet Status"));
  lines.push("");
  lines.push(...formatConfigurationSection(status));
  lines.push("");
  lines.push(...formatCredentialsSection(status));
  lines.push(...formatConnectionSection(status));
  lines.push("");
  lines.push(...formatAccountsSection(status));
  if (status.connection.status === "connected") lines.push("");
  const lightningLines = formatLightningSection(status.lightning);
  if (lightningLines.length > 0) {
    lines.push(...lightningLines);
    lines.push("");
  }
  lines.push(...formatBudgetSection(status));

  return lines.join("\n");
}

function healthEmoji(health: EndpointHealth): string {
  switch (health) {
    case "healthy":
      return chalk.green("\u25CF");
    case "degraded":
      return chalk.yellow("\u25CF");
    case "dead":
      return chalk.red("\u25CF");
  }
}

function healthLabel(health: EndpointHealth): string {
  switch (health) {
    case "healthy":
      return chalk.green("healthy");
    case "degraded":
      return chalk.yellow("degraded");
    case "dead":
      return chalk.red("dead");
  }
}

export function formatDiagnoseResult(result: DiagnoseResult): string {
  switch (result.classification) {
    case "free_confirmed":
      return renderEmptyState(
        chalk.green("\u2714"),
        "Free endpoint \u2014 no payment required",
        result.url,
      );

    case "dead": {
      const lines: string[] = [];
      lines.push(renderHeader("Endpoint Diagnostic"));
      lines.push(
        renderBox([
          `URL:       ${chalk.white(result.url)}`,
          `Status:    ${chalk.red(result.httpStatus ? `HTTP ${result.httpStatus}` : "Unreachable")}`,
          `Health:    ${healthLabel("dead")}`,
          `Reason:    ${chalk.red(formatDeathReason(result.deathReason))}`,
          `Latency:   ${renderLatencyIndicator(result.latencyMs)}`,
        ]).trimStart(),
      );
      return lines.join("\n");
    }

    case "ambiguous":
      return renderEmptyState(
        chalk.yellow("\u26A0"),
        "Ambiguous endpoint \u2014 could not confirm payment status",
        result.url,
      );

    case "paid":
      break;
  }

  const lines: string[] = [];
  lines.push(renderHeader("Endpoint Diagnostic"));

  const boxLines = [
    `URL:         ${chalk.white(result.url)}`,
    `Protocol:    ${chalk.white(result.protocol ?? "unknown")}`,
  ];

  const postOnlyNote = result.postOnly ? chalk.yellow(" (POST-only)") : "";
  boxLines.push(
    `Format:      ${chalk.white(result.formatVersion ?? "unknown")}${postOnlyNote}`,
  );

  boxLines.push(`Scheme:      ${chalk.white(result.scheme ?? "unknown")}`);

  if (result.network) {
    const shortName = networkToShortName(result.network);
    boxLines.push(
      `Network:     ${chalk.white(shortName)} ${MUTED(`(${result.network})`)}`,
    );
  }

  if (result.price) {
    boxLines.push(
      `Price:       ${chalk.yellow(result.price.toDisplayString())}`,
    );
  }

  if (result.facilitator) {
    boxLines.push(`Facilitator: ${MUTED(result.facilitator)}`);
  }

  boxLines.push(``);
  boxLines.push(
    `Health:      ${healthEmoji(result.health)} ${healthLabel(result.health)}`,
  );
  boxLines.push(`Latency:     ${renderLatencyIndicator(result.latencyMs)}`);

  lines.push(renderBox(boxLines).trimStart());

  if (result.chains && result.chains.length > 1) {
    lines.push("");
    lines.push(`  ${BRAND("Available Chains:")}`);
    for (let i = 0; i < result.chains.length; i++) {
      const chain = result.chains[i];
      if (!chain) continue;
      lines.push(
        `    ${ACCENT(`${i + 1}.`)} ${chalk.white(chain.namespace)} ${MUTED(`(${chain.network})`)} \u2014 ${chalk.yellow(chain.price.toDisplayString())}`,
      );
    }
  }

  return lines.join("\n");
}

function formatDeathReason(reason?: string): string {
  switch (reason) {
    case "dns_failure":
      return "DNS resolution failed";
    case "http_404":
      return "Not found (404)";
    case "http_5xx":
      return "Server error";
    case "timeout":
      return "Connection timed out";
    case "tls_error":
      return "TLS/SSL error";
    default:
      return "Unreachable";
  }
}

interface VerifyDirectoryEntry {
  readonly name: string;
  readonly health: EndpointHealth;
  readonly protocol: string;
  readonly price: string;
  readonly url: string;
}

export function formatVerifyDirectoryResult(
  entries: readonly VerifyDirectoryEntry[],
): string {
  if (entries.length === 0) {
    return renderEmptyState(ACCENT("\u25CB"), "No directory entries found");
  }

  const lines: string[] = [];
  lines.push(renderHeader("Directory Health Report"));
  lines.push("");

  const table = new Table({
    head: ["Name", "Status", "Protocol", "Price"],
    style: TABLE_STYLE,
    colWidths: [32, 14, 10, 12],
  });

  const counts = { healthy: 0, degraded: 0, dead: 0 };
  for (const entry of entries) {
    counts[entry.health]++;
    const statusText = `${healthEmoji(entry.health)} ${entry.health}`;
    table.push([
      chalk.white(entry.name.slice(0, NAME_COLUMN_MAX)),
      statusText,
      chalk.white(entry.protocol),
      chalk.yellow(entry.price),
    ]);
  }

  lines.push(table.toString());
  lines.push("");

  lines.push(renderHealthBar(counts, SUMMARY_BAR_WIDTH));
  lines.push("");
  lines.push(`  ${chalk.white(String(entries.length))} endpoints total`);

  return lines.join("\n");
}

interface CheckResultData {
  readonly isPaid: boolean;
  readonly protocol?: string;
  readonly amount?: string;
  readonly network?: string;
  readonly options?: readonly {
    readonly chain: string;
    readonly network: string;
    readonly amount: string;
    readonly recommended?: boolean;
  }[];
}

export function formatCheckResult(result: CheckResultData): string {
  if (!result.isPaid) {
    return renderEmptyState(
      chalk.green("\u2714"),
      "Free endpoint — no payment required",
    );
  }

  const networkName = networkToShortName(result.network);
  const testnetBadge = isTestnet(result.network)
    ? chalk.yellow(" \u26A0 TESTNET")
    : "";

  const lines: string[] = [];
  lines.push(renderHeader("Paid Endpoint"));
  lines.push(
    renderBox([
      `Protocol:  ${chalk.white(result.protocol ?? "unknown")}`,
      `Amount:    ${chalk.yellow(result.amount ?? "unknown")}`,
      `Network:   ${chalk.white(networkName)}${testnetBadge}`,
    ]).trimStart(),
  );

  if (result.options && result.options.length > 1) {
    lines.push("");
    lines.push(`  ${BRAND("Payment Options:")}`);
    for (let i = 0; i < result.options.length; i++) {
      const opt = result.options[i];
      if (!opt) continue;
      const recommended = opt.recommended
        ? chalk.green("  \u2605 recommended")
        : "";
      lines.push(
        `    ${ACCENT(`${i + 1}.`)} ${chalk.white(opt.chain)} ${MUTED(`(${opt.network})`)} \u2014 ${chalk.yellow(opt.amount)}${recommended}`,
      );
    }
  }

  return lines.join("\n");
}

export function formatDemoHeader(): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(renderHeader("BoltzPay Demo"));
  lines.push(MUTED("  Interactive walkthrough of paid API access"));
  lines.push("");
  return lines.join("\n");
}

export function formatDemoStep(step: number, message: string): string {
  if (step === 0) {
    return `${chalk.green("\u2714")} ${chalk.bold(message)}\n`;
  }
  return `${ACCENT(`[${step}]`)} ${chalk.bold(message)}\n`;
}

function formatStatusCode(status: number): string {
  if (status >= HTTP_SUCCESS_MIN && status < HTTP_SUCCESS_MAX) {
    return chalk.green(String(status));
  }
  if (status >= HTTP_CLIENT_ERROR_MIN) {
    return chalk.red(String(status));
  }
  return chalk.yellow(String(status));
}

function formatRemaining(remaining: string): string {
  if (remaining === ZERO_AMOUNT_DISPLAY) {
    return chalk.red(remaining);
  }
  return chalk.green(remaining);
}

function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) return url;
  return `${url.slice(0, maxLength - ELLIPSIS.length)}${ELLIPSIS}`;
}

export type { CheckResultData };
