import type {
  BoltzPayResponse,
  BudgetState,
  DiscoveredEntry,
  LightningStatus,
  PaymentRecord,
  WalletStatus,
} from "@boltzpay/sdk";
import { isTestnet, Money, networkToShortName } from "@boltzpay/sdk";
import chalk from "chalk";

const MAX_BODY_LENGTH = 5000;
const SEPARATOR_WIDTH = 70;
const MAX_URL_DISPLAY_LENGTH = 40;
const DATE_COLUMN_WIDTH = 20;
const PROTOCOL_COLUMN_WIDTH = 10;
const AMOUNT_COLUMN_WIDTH = 12;
const CHAIN_COLUMN_WIDTH = 8;
const ELLIPSIS = "...";
const ZERO_AMOUNT_DISPLAY = "$0.00";

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
    lines.push(chalk.bold.green("Payment"));
    lines.push(`  Protocol:  ${response.payment.protocol}`);
    lines.push(`  Amount:    ${response.payment.amount.toDisplayString()}`);
    if (response.payment.txHash) {
      lines.push(`  Tx Hash:   ${chalk.dim(response.payment.txHash)}`);
    }
    lines.push("");
  }

  lines.push(chalk.bold("Response"));
  lines.push(`  URL:       ${url}`);
  lines.push(`  Status:    ${formatStatusCode(response.status)}`);
  const contentType = response.headers["content-type"] ?? "unknown";
  lines.push(`  Type:      ${contentType}`);

  if (detail === "verbose") {
    lines.push(`  Duration:  ${duration}ms`);
    lines.push("");
    lines.push(chalk.bold("Headers"));
    for (const [key, value] of Object.entries(response.headers)) {
      lines.push(`  ${chalk.dim(key)}: ${value}`);
    }
  }

  lines.push("");
  lines.push(chalk.bold("Body"));

  if (body.length > MAX_BODY_LENGTH) {
    lines.push(body.slice(0, MAX_BODY_LENGTH));
    lines.push(chalk.dim(`...truncated (${body.length} chars total)`));
  } else {
    lines.push(body);
  }

  return lines.join("\n");
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

  lines.push(chalk.bold("Quote"));
  lines.push(`  Protocol:  ${quote.protocol}`);
  lines.push(`  Amount:    ${chalk.yellow(quote.amount)}`);
  if (quote.network) {
    const name = networkToShortName(quote.network);
    const testnetBadge = isTestnet(quote.network)
      ? chalk.yellow(" \u26A0 TESTNET")
      : "";
    lines.push(`  Network:   ${name} (${quote.network})${testnetBadge}`);
  }

  if (quote.alternatives && quote.alternatives.length > 0) {
    lines.push(`  Alternatives:`);
    for (const alt of quote.alternatives) {
      lines.push(
        `    - ${alt.network} (${alt.chain}) \u2014 ${chalk.yellow(alt.amount)}`,
      );
    }
  }

  return lines.join("\n");
}

export function formatBudgetResult(budget: BudgetState): string {
  const lines: string[] = [];
  const hasLimits =
    budget.dailyLimit || budget.monthlyLimit || budget.perTransactionLimit;

  if (!hasLimits) {
    return chalk.dim("No budget limits configured -- all payments allowed.");
  }

  lines.push(chalk.bold("Budget Status"));
  lines.push("");

  if (budget.dailyLimit) {
    const spent = budget.dailySpent.toDisplayString();
    const limit = budget.dailyLimit.toDisplayString();
    const remaining = budget.dailyRemaining
      ? budget.dailyRemaining.toDisplayString()
      : ZERO_AMOUNT_DISPLAY;
    lines.push(`  ${chalk.bold("Daily")}`);
    lines.push(`    Spent:     ${spent} / ${limit}`);
    lines.push(`    Remaining: ${formatRemaining(remaining)}`);
    lines.push("");
  }

  if (budget.monthlyLimit) {
    const spent = budget.monthlySpent.toDisplayString();
    const limit = budget.monthlyLimit.toDisplayString();
    const remaining = budget.monthlyRemaining
      ? budget.monthlyRemaining.toDisplayString()
      : ZERO_AMOUNT_DISPLAY;
    lines.push(`  ${chalk.bold("Monthly")}`);
    lines.push(`    Spent:     ${spent} / ${limit}`);
    lines.push(`    Remaining: ${formatRemaining(remaining)}`);
    lines.push("");
  }

  if (budget.perTransactionLimit) {
    lines.push(
      `  ${chalk.bold("Per Transaction")}: max ${budget.perTransactionLimit.toDisplayString()}`,
    );
  }

  return lines.join("\n");
}

function formatHistoryRows(records: readonly PaymentRecord[]): {
  readonly lines: string[];
  readonly chainTotals: Map<string, bigint>;
} {
  const lines: string[] = [];
  const chainTotals = new Map<string, bigint>();

  for (const record of records) {
    const date = record.timestamp.toISOString().slice(0, 19).replace("T", " ");
    const chain = networkToShortName(record.network);
    const url = truncateUrl(record.url, MAX_URL_DISPLAY_LENGTH);
    lines.push(
      `  ${pad(date, DATE_COLUMN_WIDTH)} ${pad(record.protocol, PROTOCOL_COLUMN_WIDTH)} ${pad(record.amount.toDisplayString(), AMOUNT_COLUMN_WIDTH)} ${pad(chain, CHAIN_COLUMN_WIDTH)} ${url}`,
    );
    const existing = chainTotals.get(chain) ?? 0n;
    chainTotals.set(chain, existing + record.amount.cents);
  }

  return { lines, chainTotals };
}

export function formatHistoryResult(records: readonly PaymentRecord[]): string {
  if (records.length === 0) {
    return chalk.dim("No payments made yet.");
  }

  const lines: string[] = [];
  lines.push(chalk.bold("Payment History"));
  lines.push("");

  const header = `  ${pad("Date", DATE_COLUMN_WIDTH)} ${pad("Protocol", PROTOCOL_COLUMN_WIDTH)} ${pad("Amount", AMOUNT_COLUMN_WIDTH)} ${pad("Chain", CHAIN_COLUMN_WIDTH)} URL`;
  lines.push(chalk.dim(header));
  lines.push(chalk.dim(`  ${"-".repeat(SEPARATOR_WIDTH)}`));

  const { lines: rows, chainTotals } = formatHistoryRows(records);
  lines.push(...rows);
  lines.push("");
  lines.push(chalk.dim(`  ${records.length} payment(s) total`));

  if (chainTotals.size > 0) {
    const totalsStr = [...chainTotals.entries()]
      .map(
        ([chain, cents]) =>
          `${chain} ${Money.fromCents(cents).toDisplayString()}`,
      )
      .join(" \u00B7 ");
    lines.push(chalk.dim(`  By chain: ${totalsStr}`));
  }

  return lines.join("\n");
}

export function formatDiscoverResult(
  entries: readonly DiscoveredEntry[],
): string {
  if (entries.length === 0) {
    return chalk.dim("No matching endpoints found.");
  }

  const counts = { live: 0, free: 0, offline: 0, error: 0 };
  const lines: string[] = [];
  lines.push(chalk.bold("Compatible Paid API Endpoints"));
  lines.push("");

  for (const entry of entries) {
    counts[entry.live.status]++;

    const badge = formatStatusBadge(entry);
    const price = formatStatusPrice(entry);

    lines.push(`  ${chalk.bold(entry.name)} ${badge}`);
    lines.push(`    ${entry.description}`);
    lines.push(`    URL:   ${chalk.cyan(entry.url)}`);
    lines.push(`    Price: ${price}`);
    lines.push(`    Category: ${entry.category}`);
    lines.push("");
  }

  const parts: string[] = [];
  if (counts.live > 0) parts.push(`${counts.live} live`);
  if (counts.free > 0) parts.push(`${counts.free} free`);
  if (counts.offline > 0) parts.push(`${counts.offline} offline`);
  if (counts.error > 0) parts.push(`${counts.error} error`);
  lines.push(chalk.dim(`${entries.length} endpoint(s): ${parts.join(", ")}`));

  return lines.join("\n");
}

function formatStatusBadge(entry: DiscoveredEntry): string {
  switch (entry.live.status) {
    case "live":
      return chalk.green(`[LIVE]`) + chalk.dim(` (${entry.live.protocol})`);
    case "free":
      return chalk.blue("[FREE]");
    case "offline":
      return chalk.yellow("[OFFLINE]");
    case "error":
      return chalk.red("[ERROR]");
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
      return `${chalk.yellow(entry.pricing)} ${chalk.dim("(unverified)")}`;
    case "error":
      return `${chalk.yellow(entry.pricing)} ${chalk.dim("(unverified)")}`;
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
    : " (mainnet)";
  lines.push(chalk.bold("  Configuration"));
  lines.push(`    Network:    ${status.network}${testnetBadge}`);
  lines.push(`    Protocols:  ${status.protocols.join(", ")}`);
  lines.push(
    `    Can pay:    ${status.canPay ? chalk.green("Yes") : chalk.red("No")}`,
  );
  return lines;
}

function formatCredentialsSection(status: WalletStatus): string[] {
  const lines: string[] = [];
  lines.push(chalk.bold("  Coinbase CDP"));
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
      `    Connection: ${chalk.green("Connected")} (${status.connection.latencyMs}ms)`,
    );
  } else if (status.connection.status === "error") {
    lines.push(
      `    Connection: ${chalk.red("Failed")} (${status.connection.error})`,
    );
  } else {
    lines.push(`    Connection: ${chalk.dim("Skipped")}`);
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
  lines.push(chalk.bold("  Accounts"));
  if (status.accounts.evm) {
    const balanceStr = status.accounts.evm.balance
      ? chalk.green(status.accounts.evm.balance.toDisplayString())
      : chalk.dim("unknown");
    lines.push(
      `    EVM:        ${status.accounts.evm.address}    ${balanceStr} USDC`,
    );
  } else {
    lines.push(`    EVM:        ${chalk.dim("Not provisioned")}`);
  }
  if (status.accounts.svm) {
    const balanceStr = status.accounts.svm.balance
      ? chalk.green(status.accounts.svm.balance.toDisplayString())
      : chalk.dim("unknown");
    lines.push(
      `    Solana:     ${status.accounts.svm.address}    ${balanceStr} USDC`,
    );
  } else {
    lines.push(`    Solana:     ${chalk.dim("Not provisioned")}`);
  }
  return lines;
}

function formatLightningSection(
  lightning: LightningStatus | undefined,
): string[] {
  if (!lightning) return [];

  const lines: string[] = [];
  lines.push(chalk.bold("  Lightning (NWC)"));

  if (lightning.connection.status === "connected") {
    lines.push(
      `    Connection: ${chalk.green("Connected")} (${lightning.connection.latencyMs}ms)`,
    );
    if (lightning.balance) {
      lines.push(`    Balance:    ${chalk.green(lightning.balance.display)}`);
    }
  } else if (lightning.connection.status === "error") {
    lines.push(
      `    Connection: ${chalk.red("Failed")} (${lightning.connection.error})`,
    );
  } else {
    lines.push(`    Connection: ${chalk.dim("Skipped")}`);
  }

  return lines;
}

function formatBudgetSection(status: WalletStatus): string[] {
  const lines: string[] = [];
  lines.push(chalk.bold("  Budget"));
  const hasLimits =
    status.budget.dailyLimit ||
    status.budget.monthlyLimit ||
    status.budget.perTransactionLimit;
  if (!hasLimits) {
    lines.push(`    ${chalk.dim("No limits configured")}`);
    return lines;
  }

  if (status.budget.dailyLimit) {
    const remaining =
      status.budget.dailyRemaining?.toDisplayString() ?? ZERO_AMOUNT_DISPLAY;
    lines.push(
      `    Daily:      ${status.budget.dailySpent.toDisplayString()} / ${status.budget.dailyLimit.toDisplayString()} (${remaining} remaining)`,
    );
  }
  if (status.budget.monthlyLimit) {
    const remaining =
      status.budget.monthlyRemaining?.toDisplayString() ?? ZERO_AMOUNT_DISPLAY;
    lines.push(
      `    Monthly:    ${status.budget.monthlySpent.toDisplayString()} / ${status.budget.monthlyLimit.toDisplayString()} (${remaining} remaining)`,
    );
  }
  if (status.budget.perTransactionLimit) {
    lines.push(
      `    Per tx:     max ${status.budget.perTransactionLimit.toDisplayString()}`,
    );
  }
  return lines;
}

export function formatWalletStatus(status: WalletStatus): string {
  const lines: string[] = [];

  lines.push(chalk.bold("Wallet Status"));
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
    return chalk.dim("Free endpoint (no payment required)");
  }

  const networkName = networkToShortName(result.network);
  const testnetBadge = isTestnet(result.network)
    ? chalk.yellow(" \u26A0 TESTNET")
    : "";
  const base = `${chalk.green("Paid endpoint")} (${result.protocol}, ${chalk.yellow(result.amount ?? "unknown")}, ${networkName}${testnetBadge})`;

  if (result.options && result.options.length > 1) {
    const lines: string[] = [base];
    lines.push("  Options:");
    for (let i = 0; i < result.options.length; i++) {
      const opt = result.options[i];
      if (!opt) continue;
      const recommended = opt.recommended ? chalk.green("  [recommended]") : "";
      lines.push(
        `    ${i + 1}. ${opt.chain} (${opt.network}) \u2014 ${chalk.yellow(opt.amount)}${recommended}`,
      );
    }
    return lines.join("\n");
  }

  return base;
}

function formatStatusCode(status: number): string {
  if (status >= 200 && status < 300) {
    return chalk.green(String(status));
  }
  if (status >= 400) {
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

function pad(text: string, width: number): string {
  return text.padEnd(width);
}

function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) return url;
  return `${url.slice(0, maxLength - ELLIPSIS.length)}${ELLIPSIS}`;
}

export function formatDemoHeader(): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.cyan("  BoltzPay Demo"));
  lines.push(chalk.dim("  Interactive walkthrough of paid API access"));
  lines.push(chalk.dim(`  ${"─".repeat(50)}`));
  lines.push("");
  return lines.join("\n");
}

export function formatDemoStep(step: number, message: string): string {
  if (step === 0) {
    return `${chalk.green("✓")} ${chalk.bold(message)}\n`;
  }
  return `${chalk.cyan(`[${step}]`)} ${chalk.bold(message)}\n`;
}

export type { CheckResultData };
