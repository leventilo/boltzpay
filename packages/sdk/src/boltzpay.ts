import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AcceptOption,
  type ChainCapabilities,
  type ChainNamespace,
  type EndpointInputHints,
  Money,
  NoCompatibleChainError,
  type ProtocolAdapter,
  ProtocolDetectionFailedError,
  type ProtocolQuote,
  type ProtocolResult,
  parseNetworkIdentifier,
  selectBestAccept,
} from "@boltzpay/core";
import {
  AdapterError,
  AggregatePaymentError,
  type CdpMultiChainClient,
  CdpWalletManager,
  createMppMethod,
  L402Adapter,
  MppAdapter,
  MppMethodSelector,
  MppSessionManager,
  NwcWalletManager,
  type ProbeResult,
  ProtocolRouter,
  X402Adapter,
  X402PaymentError,
} from "@boltzpay/protocols";
import { toBudgetExceededCode } from "./budget/budget-exceeded-codes";
import type { BudgetLimits, BudgetState } from "./budget/budget-manager";
import { BudgetManager } from "./budget/budget-manager";
import { hasCoinbaseCredentials, validateConfig } from "./config/schema";
import type { BoltzPayConfig, ValidatedConfig } from "./config/types";
import type { DiagnoseResult } from "./diagnostics/diagnose";
import { diagnoseEndpoint } from "./diagnostics/diagnose";
import type { DryRunResult } from "./diagnostics/dry-run";
import { BoltzPayError } from "./errors/boltzpay-error";
import { BudgetExceededError } from "./errors/budget-exceeded-error";
import { ConfigurationError } from "./errors/configuration-error";
import { MppSessionBudgetError } from "./errors/mpp-session-error";
import { NetworkError } from "./errors/network-error";
import { NoWalletError } from "./errors/no-wallet-error";
import { PaymentUncertainError } from "./errors/payment-uncertain-error";
import type { DeliveryDiagnosis } from "./errors/protocol-error";
import { isProtocolErrorCode, ProtocolError } from "./errors/protocol-error";
import { UnsupportedNetworkError } from "./errors/unsupported-network-error";
import { UnsupportedSchemeError } from "./errors/unsupported-scheme-error";
import { TypedEventEmitter } from "./events/event-emitter";
import type { EventListener, EventName } from "./events/types";
import { exportCSV, exportJSON } from "./history/export";
import { PaymentHistory } from "./history/payment-history";
import type { PaymentDetails, PaymentRecord } from "./history/types";
import type { Logger } from "./logger/logger";
import { createLogger } from "./logger/logger";
import {
  createMcpPaymentWrapper,
  type WrappedMcpClient,
} from "./mcp-payment/mcp-payment-wrapper";
import type { PaymentMetrics } from "./metrics/metrics";
import { computeMetrics } from "./metrics/metrics";
import { isTestnet } from "./network-utils";
import { FileAdapter } from "./persistence/file-adapter";
import { MemoryAdapter } from "./persistence/memory-adapter";
import type { StorageAdapter } from "./persistence/storage-adapter";
import {
  DEFAULT_REGISTRY_URL,
  fetchRegistryEndpoints,
} from "./registry/registry-client";
import type {
  DiscoveredEntry,
  DiscoverOptions,
} from "./registry/registry-types";
import { BoltzPayResponse } from "./response/boltzpay-response";
import type { RateLimitStrategy } from "./retry/retry-config";
import type { RetryOptions } from "./retry/retry-engine";
import { withRetry } from "./retry/retry-engine";
import { BoltzPaySession } from "./session/boltzpay-session";
import type {
  BoltzPaySessionOptions,
  SessionReceipt,
} from "./session/session-types";
import type { LightningStatus, WalletStatus } from "./wallet-status";

export interface FetchOptions {
  maxAmount?: number | string;
  headers?: Record<string, string>;
  method?: string;
  body?: Uint8Array;
  chain?: ChainNamespace;
  dryRun?: boolean;
}

export interface QuoteResult {
  amount: Money;
  protocol: string;
  network: string | undefined;
  allAccepts?: readonly AcceptOption[];
  inputHints?: EndpointInputHints;
}

interface PaymentFlowInput {
  readonly url: string;
  readonly adapter: ProtocolAdapter;
  readonly quote: ProtocolQuote;
  readonly options?: FetchOptions;
  readonly wallet?: ResolvedWallet;
}

interface SuccessResponseInput {
  readonly url: string;
  readonly adapter: ProtocolAdapter;
  readonly quote: ProtocolQuote;
  readonly result: ProtocolResult;
  readonly durationMs?: number;
}

function toMoney(value: string | number): Money {
  const dollars = typeof value === "string" ? value : value.toFixed(2);
  return Money.fromDollars(dollars);
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 200;
const DEFAULT_RATE_LIMIT_STRATEGY = "wait";
const DEFAULT_MAX_RATE_LIMIT_WAIT_MS = 60_000;

const PASSTHROUGH_TIMEOUT_MS = 30_000;

const POST_SIGNATURE_NETWORK_ERROR_PATTERNS = [
  "econnreset",
  "econnrefused",
  "etimedout",
  "epipe",
  "enotfound",
  "fetch failed",
  "network error",
  "socket hang up",
  "abort",
];

const SERVER_MESSAGE_MAX_LENGTH = 500;

function extractServerMessage(
  body: Uint8Array | undefined,
): string | undefined {
  if (!body || body.length === 0) return undefined;
  let text: string;
  try {
    text = new TextDecoder().decode(body);
  } catch {
    // Intent: binary or non-UTF-8 body cannot be decoded — return no message
    return undefined;
  }
  if (!text.trim()) return undefined;

  try {
    const json: unknown = JSON.parse(text);
    if (typeof json === "object" && json !== null) {
      const obj = json as Record<string, unknown>;
      if (typeof obj.error === "string") return obj.error;
      if (typeof obj.message === "string") return obj.message;
      if (typeof obj.error === "object" && obj.error !== null) {
        const nested = obj.error as Record<string, unknown>;
        if (typeof nested.message === "string") return nested.message;
      }
    }
  } catch {
    // Intent: response body may not be valid JSON — fall through to raw text truncation
  }

  return text.length > SERVER_MESSAGE_MAX_LENGTH
    ? `${text.slice(0, SERVER_MESSAGE_MAX_LENGTH)}…`
    : text;
}

function diagnoseDeliveryFailure(
  status: number,
  serverMessage: string | undefined,
): DeliveryDiagnosis {
  const detail = serverMessage ? ` ${serverMessage}` : "";
  if (status === 401) {
    return {
      phase: "delivery",
      paymentSent: true,
      serverStatus: status,
      serverMessage,
      suggestion: `Server requires additional authentication beyond payment.${detail}`,
    };
  }
  if (status === 400) {
    return {
      phase: "delivery",
      paymentSent: true,
      serverStatus: status,
      serverMessage,
      suggestion: `Server rejected the request.${detail}`,
    };
  }
  if (status === 403) {
    return {
      phase: "delivery",
      paymentSent: true,
      serverStatus: status,
      serverMessage,
      suggestion: `Access denied after payment.${detail}`,
    };
  }
  if (status === 404) {
    return {
      phase: "delivery",
      paymentSent: true,
      serverStatus: status,
      serverMessage,
      suggestion: "Endpoint not found after payment. Check the URL.",
    };
  }
  if (status >= 500 && status < 600) {
    return {
      phase: "delivery",
      paymentSent: true,
      serverStatus: status,
      serverMessage,
      suggestion: `Server error after payment.${detail}`,
    };
  }
  return {
    phase: "delivery",
    paymentSent: true,
    serverStatus: status,
    serverMessage,
    suggestion: `Unexpected response after payment (HTTP ${status}).${detail}`,
  };
}

const KEY_HINT_SUFFIX_LENGTH = 4;

function maskKey(key: string): string {
  if (key.length <= KEY_HINT_SUFFIX_LENGTH) return key;
  return `…${key.slice(-KEY_HINT_SUFFIX_LENGTH)}`;
}

function resolveStorage(config: ValidatedConfig): StorageAdapter {
  const storage = config.storage;
  if (storage) {
    if (typeof storage === "string") {
      if (storage === "file") return new FileAdapter();
      if (storage === "memory") return new MemoryAdapter();
    }
    if (typeof storage === "object" && "get" in storage && "set" in storage) {
      return storage as StorageAdapter;
    }
    if (typeof storage === "object" && "type" in storage) {
      const cfg = storage as { type: string; dir?: string };
      if (cfg.type === "file") return new FileAdapter({ dir: cfg.dir });
    }
  }
  if (config.persistence?.enabled) {
    return new FileAdapter({ dir: config.persistence.directory });
  }
  return new MemoryAdapter();
}

const DEFAULT_MAX_HISTORY_RECORDS = 1000;
const LEGACY_DEFAULT_MAX_HISTORY_RECORDS = 500;

function resolveMaxHistoryRecords(config: ValidatedConfig): number {
  const storage = config.storage;
  if (
    storage &&
    typeof storage === "object" &&
    "type" in storage &&
    "maxHistoryRecords" in storage
  ) {
    const cfg = storage as { maxHistoryRecords?: number };
    return cfg.maxHistoryRecords ?? DEFAULT_MAX_HISTORY_RECORDS;
  }
  if (config.persistence?.enabled) {
    return (
      config.persistence.historyMaxRecords ?? LEGACY_DEFAULT_MAX_HISTORY_RECORDS
    );
  }
  return DEFAULT_MAX_HISTORY_RECORDS;
}

const LEGACY_DATA_DIR = ".boltzpay";

const MPP_METHOD_TO_WALLET: Readonly<Record<string, string>> = {
  lightning: "nwc",
  stripe: "stripe-mpp",
  tempo: "tempo",
  card: "visa-mpp",
};

const RESOLVED_WALLET_TYPES = [
  "coinbase",
  "nwc",
  "stripe-mpp",
  "tempo",
  "visa-mpp",
] as const;
type ResolvedWalletType = (typeof RESOLVED_WALLET_TYPES)[number];

interface MppRawConfig {
  readonly type: string;
  readonly tempoPrivateKey?: string;
  readonly stripeSecretKey?: string;
  readonly nwcConnectionString?: string;
  readonly visaJwe?: string;
}

interface ResolvedWallet {
  readonly name: string;
  readonly type: ResolvedWalletType;
  readonly cdpManager?: CdpWalletManager;
  readonly nwcManager?: NwcWalletManager;
  readonly networks?: readonly string[];
  readonly rawConfig?: MppRawConfig;
}

export class BoltzPay {
  private readonly router: ProtocolRouter;
  private readonly budgetManager: BudgetManager;
  private readonly history: PaymentHistory;
  private readonly emitter: TypedEventEmitter;
  private readonly logger: Logger;
  private readonly config: ValidatedConfig;
  private readonly wallets: readonly ResolvedWallet[];
  private readonly storage: StorageAdapter;
  private readonly initPromise: Promise<void>;
  private errorCount = 0;
  private paymentLock: Promise<void> = Promise.resolve();

  private get primaryCdpManager(): CdpWalletManager | undefined {
    return this.wallets.find((w) => w.type === "coinbase")?.cdpManager;
  }

  private get primaryNwcManager(): NwcWalletManager | undefined {
    return this.wallets.find((w) => w.type === "nwc")?.nwcManager;
  }

  constructor(config: BoltzPayConfig) {
    this.config = validateConfig(config);
    this.logger = createLogger(this.config.logLevel, this.config.logFormat);

    this.wallets = this.resolveWallets(this.config);

    this.router = new ProtocolRouter(this.createAdapters());
    this.emitter = new TypedEventEmitter();
    this.emitter.on("error", () => {
      this.errorCount++;
    });

    this.storage = resolveStorage(this.config);

    const budgetLimits = this.createBudgetLimits();
    this.budgetManager = new BudgetManager(budgetLimits, this.storage);

    const maxRecords = resolveMaxHistoryRecords(this.config);
    this.history = new PaymentHistory({
      storage: this.storage,
      maxRecords,
    });

    this.initPromise = this.initialize();

    if (this.config.network === "base-sepolia") {
      this.logger.warn("Running on testnet (base-sepolia)");
    }
  }

  private resolveWallets(config: ValidatedConfig): ResolvedWallet[] {
    if (config.wallets !== undefined) {
      return config.wallets.map((w) => this.createResolvedWallet(w));
    }

    const wallets: ResolvedWallet[] = [];

    if (hasCoinbaseCredentials(config)) {
      wallets.push({
        name: "default",
        type: "coinbase",
        cdpManager: this.createCdpManager(config, "boltzpay-default"),
        networks: undefined,
      });
    }

    if (config.nwcConnectionString) {
      wallets.push({
        name: "default-nwc",
        type: "nwc",
        nwcManager: new NwcWalletManager(config.nwcConnectionString),
        networks: undefined,
      });
    }

    return wallets;
  }

  private createResolvedWallet(
    walletConfig: NonNullable<ValidatedConfig["wallets"]>[number],
  ): ResolvedWallet {
    if (walletConfig.type === "coinbase") {
      const wc = walletConfig;
      return {
        name: wc.name,
        type: "coinbase",
        cdpManager: this.createCdpManager(
          {
            coinbaseApiKeyId: wc.coinbaseApiKeyId,
            coinbaseApiKeySecret: wc.coinbaseApiKeySecret,
            coinbaseWalletSecret: wc.coinbaseWalletSecret,
          },
          `boltzpay-${wc.name}`,
        ),
        networks: wc.networks,
      };
    }
    if (walletConfig.type === "nwc") {
      const wc = walletConfig;
      return {
        name: wc.name,
        type: "nwc",
        nwcManager: new NwcWalletManager(wc.nwcConnectionString),
        networks: wc.networks,
      };
    }
    return {
      name: walletConfig.name,
      type: walletConfig.type,
      networks: walletConfig.networks,
      rawConfig: this.extractMppRawConfig(walletConfig),
    };
  }

  private extractMppRawConfig(
    walletConfig: NonNullable<ValidatedConfig["wallets"]>[number],
  ): MppRawConfig {
    const raw: MppRawConfig = { type: walletConfig.type };
    if (walletConfig.type === "tempo") {
      return { ...raw, tempoPrivateKey: walletConfig.tempoPrivateKey };
    }
    if (walletConfig.type === "stripe-mpp") {
      return { ...raw, stripeSecretKey: walletConfig.stripeSecretKey };
    }
    if (walletConfig.type === "nwc") {
      return { ...raw, nwcConnectionString: walletConfig.nwcConnectionString };
    }
    if (walletConfig.type === "visa-mpp") {
      return { ...raw, visaJwe: walletConfig.visaJwe };
    }
    return raw;
  }

  private createCdpManager(
    creds: {
      coinbaseApiKeyId: string;
      coinbaseApiKeySecret: string;
      coinbaseWalletSecret: string;
    },
    label: string,
  ): CdpWalletManager {
    return new CdpWalletManager(async () => {
      const cdpModule: unknown = await import("@coinbase/cdp-sdk");
      if (
        !cdpModule ||
        typeof cdpModule !== "object" ||
        !("CdpClient" in cdpModule)
      ) {
        throw new ConfigurationError(
          "invalid_config",
          "@coinbase/cdp-sdk module does not export CdpClient",
        );
      }
      const { CdpClient } = cdpModule as {
        CdpClient: new (opts: {
          apiKeyId: string;
          apiKeySecret: string;
          walletSecret: string;
        }) => CdpMultiChainClient;
      };
      return new CdpClient({
        apiKeyId: creds.coinbaseApiKeyId,
        apiKeySecret: creds.coinbaseApiKeySecret,
        walletSecret: creds.coinbaseWalletSecret,
      });
    }, label);
  }

  private getPayableNamespaces(): readonly ChainNamespace[] {
    const namespaces = new Set<ChainNamespace>();
    for (const w of this.wallets) {
      if (w.type === "nwc") continue;
      if (!w.networks) {
        namespaces.add("evm");
        namespaces.add("svm");
      } else {
        for (const ns of w.networks) {
          if (ns === "evm" || ns === "svm") {
            namespaces.add(ns);
          }
        }
      }
    }
    return [...namespaces];
  }

  private selectWalletForPayment(
    quote: ProtocolQuote,
    url: string,
  ): ResolvedWallet {
    if (quote.protocol === "mpp") {
      return this.selectMppWallet(quote);
    }

    if (quote.protocol === "l402") {
      const nwcWallet = this.wallets.find((w) => w.type === "nwc");
      if (!nwcWallet) {
        throw new NoWalletError("lightning", this.getAvailableNetworksList());
      }
      this.emitter.emit("wallet:selected", {
        walletName: nwcWallet.name,
        network: "lightning",
        reason: "only_match",
      });
      return nwcWallet;
    }

    if (!quote.network) {
      const first = this.wallets.find((w) => w.type === "coinbase");
      if (!first) {
        throw new NoWalletError("unknown", this.getAvailableNetworksList());
      }
      this.emitter.emit("wallet:selected", {
        walletName: first.name,
        network: "unknown",
        reason: "only_match",
      });
      return first;
    }

    const parsed = this.tryParseNetwork(quote.network);
    if (!parsed) {
      const first = this.wallets.find((w) => w.type === "coinbase");
      if (!first) {
        throw new NoWalletError(quote.network, this.getAvailableNetworksList());
      }
      this.emitter.emit("wallet:selected", {
        walletName: first.name,
        network: quote.network,
        reason: "only_match",
      });
      return first;
    }

    if (parsed.namespace === "stellar") {
      this.emitter.emit("protocol:unsupported-network", {
        namespace: "stellar",
        url,
      });
      throw new UnsupportedNetworkError("stellar");
    }

    const matching = this.wallets.filter(
      (w) =>
        w.type === "coinbase" &&
        (!w.networks || w.networks.includes(parsed.namespace)),
    );

    if (matching.length === 0) {
      throw new NoWalletError(
        parsed.namespace,
        this.getAvailableNetworksList(),
      );
    }

    const selected = matching[0];
    if (!selected) {
      throw new NoWalletError(
        parsed.namespace,
        this.getAvailableNetworksList(),
      );
    }
    this.emitter.emit("wallet:selected", {
      walletName: selected.name,
      network: parsed.namespace,
      reason: matching.length === 1 ? "only_match" : "first_match",
    });
    return selected;
  }

  private getAvailableNetworksList(): string[] {
    return this.wallets.flatMap((w) =>
      w.networks ? [...w.networks] : ["all"],
    );
  }

  private selectMppWallet(quote: ProtocolQuote): ResolvedWallet {
    const method = quote.selectedMethod;
    if (!method) {
      throw new NoWalletError("mpp", this.getAvailableNetworksList());
    }
    const walletType = MPP_METHOD_TO_WALLET[method];
    if (!walletType) {
      throw new NoWalletError(method, this.getAvailableNetworksList());
    }
    const wallet = this.wallets.find((w) => w.type === walletType);
    if (!wallet) {
      throw new NoWalletError(method, this.getAvailableNetworksList());
    }
    this.emitter.emit("wallet:selected", {
      walletName: wallet.name,
      network: method,
      reason: "only_match",
    });
    return wallet;
  }

  private sortProbesByWalletAvailability(
    probes: readonly ProbeResult[],
  ): readonly ProbeResult[] {
    const walletTypes = new Set(this.wallets.map((w) => w.type));
    return [...probes].sort((a, b) => {
      const aHasWallet = this.probeHasMatchingWallet(a, walletTypes);
      const bHasWallet = this.probeHasMatchingWallet(b, walletTypes);
      if (aHasWallet === bHasWallet) return 0;
      return aHasWallet ? -1 : 1;
    });
  }

  private probeHasMatchingWallet(
    probe: ProbeResult,
    walletTypes: ReadonlySet<string>,
  ): boolean {
    const adapterName = probe.adapter.name;
    if (adapterName === "mpp") {
      const method = probe.quote.selectedMethod;
      if (!method) return false;
      const walletType = MPP_METHOD_TO_WALLET[method];
      return !!walletType && walletTypes.has(walletType);
    }
    if (adapterName === "l402") {
      return walletTypes.has("nwc");
    }
    return walletTypes.has("coinbase");
  }

  private createAdapters(): ProtocolAdapter[] {
    const validateUrl = (url: string) => {
      try {
        new URL(url);
      } catch {
        throw new ProtocolError("payment_failed", `Invalid URL: ${url}`);
      }
    };

    const timeouts = this.config.timeouts;

    const mppWalletTypes = new Set(
      this.wallets
        .filter((w) =>
          (["stripe-mpp", "tempo", "visa-mpp", "nwc"] as const).includes(
            w.type as "stripe-mpp" | "tempo" | "visa-mpp" | "nwc",
          ),
        )
        .map((w) => w.type),
    );
    const methodSelector = new MppMethodSelector(
      mppWalletTypes,
      this.config.mppPreferredMethods ?? [],
    );

    return [
      new MppAdapter(methodSelector, validateUrl, timeouts),
      new X402Adapter(this.primaryCdpManager, validateUrl, timeouts),
      new L402Adapter(this.primaryNwcManager, validateUrl, timeouts),
    ];
  }

  private createBudgetLimits(): BudgetLimits | undefined {
    const budget = this.config.budget;
    if (!budget) {
      return undefined;
    }
    return {
      daily: budget.daily ? toMoney(budget.daily) : undefined,
      monthly: budget.monthly ? toMoney(budget.monthly) : undefined,
      perTransaction: budget.perTransaction
        ? toMoney(budget.perTransaction)
        : undefined,
      warningThreshold: budget.warningThreshold,
      satToUsdRate: budget.satToUsdRate,
    };
  }

  private async initialize(): Promise<void> {
    await this.budgetManager.loadFromStorage();
    await this.history.loadFromStorage();
    this.detectLegacyFiles();
  }

  private detectLegacyFiles(): void {
    try {
      const legacyDir = join(homedir(), LEGACY_DATA_DIR);
      const budgetFile = join(legacyDir, "budget.json");
      const historyFile = join(legacyDir, "history.jsonl");
      if (existsSync(budgetFile) || existsSync(historyFile)) {
        this.logger.info(
          "Legacy v0.1 data files detected. v0.2 uses a new storage format — starting fresh.",
        );
      }
    } catch {
      // Intent: legacy v0.1 detection is best-effort — missing dir is normal on fresh installs
    }
  }

  private buildRetryOptions(phase: string): RetryOptions {
    const retry = this.config.retry;
    const rateLimit = this.config.rateLimit;
    return {
      maxRetries: retry?.maxRetries ?? DEFAULT_MAX_RETRIES,
      backoffMs: retry?.backoffMs ?? DEFAULT_BACKOFF_MS,
      rateLimitStrategy: (rateLimit?.strategy ??
        DEFAULT_RATE_LIMIT_STRATEGY) as RateLimitStrategy,
      maxRateLimitWaitMs:
        rateLimit?.maxWaitMs ?? DEFAULT_MAX_RATE_LIMIT_WAIT_MS,
      logger: this.logger,
      emitter: this.emitter,
      phase,
    };
  }

  async fetch(
    url: string,
    options: FetchOptions & { dryRun: true },
  ): Promise<DryRunResult>;
  async fetch(url: string, options?: FetchOptions): Promise<BoltzPayResponse>;
  async fetch(
    url: string,
    options?: FetchOptions,
  ): Promise<BoltzPayResponse | DryRunResult> {
    if (options?.dryRun) {
      return this.executeDryRun(url, options);
    }

    await this.initPromise;
    this.checkDomainPolicy(url);
    this.logger.debug(`Fetching ${url}`);

    const fetchStart = Date.now();

    const probeResults = await withRetry(
      () => this.probeOrPassthrough(url, options),
      this.buildRetryOptions("detect"),
    );
    if (probeResults instanceof BoltzPayResponse) {
      return probeResults;
    }

    if (probeResults.length === 0) {
      throw new ProtocolError("protocol_detection_failed", "No probe results");
    }

    const sorted = this.sortProbesByWalletAvailability(probeResults);
    return this.executeWithWalletFallback(url, sorted, options, fetchStart);
  }

  async openSession(
    url: string,
    options?: BoltzPaySessionOptions,
  ): Promise<BoltzPaySession> {
    await this.initPromise;
    this.checkDomainPolicy(url);

    const tempoWallet = this.wallets.find((w) => w.type === "tempo");
    if (!tempoWallet?.rawConfig?.tempoPrivateKey) {
      throw new NoWalletError("tempo", this.getAvailableNetworksList());
    }

    const maxDeposit = this.computeSessionDeposit(options?.maxDeposit);
    if (maxDeposit.isZero()) {
      throw new MppSessionBudgetError(Money.fromCents(1n), maxDeposit);
    }

    const reservationId = this.reserveSessionBudget(maxDeposit);

    try {
      const sessionManager = new MppSessionManager(
        { tempoPrivateKey: tempoWallet.rawConfig.tempoPrivateKey },
        (entry) => {
          this.emitter.emit("session:voucher", {
            channelId: entry.channelId,
            cumulativeAmount: entry.cumulativeAmount,
            index: 0,
          });
        },
      );

      const maxDepositRaw = this.moneyToUsdcRaw(maxDeposit);
      const managedSession = await sessionManager.openSession(url, {
        maxDeposit: maxDepositRaw,
        signal: options?.signal,
      });

      const sessionId = crypto.randomUUID();
      const bpSession = new BoltzPaySession({
        session: managedSession,
        budgetManager: this.budgetManager,
        emitter: this.emitter,
        history: this.history,
        url,
        depositAmount: maxDeposit,
        reservationId,
        sessionId,
      });

      this.emitter.emit("session:open", {
        channelId: managedSession.channelId,
        depositAmount: maxDeposit,
        url,
      });

      return bpSession;
    } catch (err) {
      // Release reservation on failure to prevent budget leak
      this.budgetManager.release(reservationId, maxDeposit);
      if (err instanceof BoltzPayError) throw err;
      const msg = err instanceof Error ? err.message : "Session open failed";
      throw new ProtocolError("payment_failed", `Session open failed: ${msg}`);
    }
  }

  private computeSessionDeposit(userMaxDeposit?: number | string): Money {
    const candidates: Money[] = [];

    const available = this.budgetManager.availableForReservation();
    if (available) candidates.push(available);

    if (this.config.sessionMaxDeposit) {
      candidates.push(toMoney(this.config.sessionMaxDeposit));
    }

    if (userMaxDeposit !== undefined) {
      candidates.push(toMoney(userMaxDeposit));
    }

    if (candidates.length === 0) return Money.fromDollars("10.00");
    return candidates.reduce((min, c) => (c.greaterThan(min) ? min : c));
  }

  private reserveSessionBudget(amount: Money): string {
    try {
      return this.budgetManager.reserve(amount);
    } catch {
      const available =
        this.budgetManager.availableForReservation() ?? Money.zero();
      throw new MppSessionBudgetError(amount, available);
    }
  }

  private moneyToUsdcRaw(money: Money): bigint {
    // Convert USD cents to USDC raw atomic units (6 decimals): 100 cents = 1_000_000 raw
    const CENTS_TO_RAW = 10000n; // 1_000_000 / 100
    return money.cents * CENTS_TO_RAW;
  }

  private async executeDryRun(
    url: string,
    options?: FetchOptions,
  ): Promise<DryRunResult> {
    await this.initPromise;

    try {
      this.checkDomainPolicy(url);
    } catch (err) {
      if (err instanceof ConfigurationError) {
        return { wouldPay: false, reason: "domain_blocked" };
      }
      return { wouldPay: false, reason: "network_error" };
    }

    let probeResults: readonly ProbeResult[];
    try {
      probeResults = await this.router.probeAll(url, options?.headers);
    } catch (err) {
      if (err instanceof ProtocolDetectionFailedError) {
        return { wouldPay: false, reason: "not_paid" };
      }
      return { wouldPay: false, reason: "network_error" };
    }

    const primary = probeResults[0];
    if (!primary) {
      return { wouldPay: false, reason: "detection_failed" };
    }

    let selectedQuote: ProtocolQuote;
    try {
      selectedQuote = this.selectPaymentChain(primary.quote, options);
    } catch {
      // Intent: no compatible chain available — report as detection_failed with partial quote
      return {
        wouldPay: false,
        reason: "detection_failed",
        quote: {
          amount: primary.quote.amount,
          protocol: primary.adapter.name,
          network: primary.quote.network,
          scheme: primary.quote.scheme,
        },
      };
    }

    const quoteInfo = {
      amount: selectedQuote.amount,
      protocol: primary.adapter.name,
      network: selectedQuote.network,
      scheme: selectedQuote.scheme,
    };

    try {
      this.guardScheme(selectedQuote, url);
    } catch (err) {
      if (err instanceof UnsupportedSchemeError) {
        return {
          wouldPay: false,
          reason: "unsupported_scheme",
          quote: quoteInfo,
        };
      }
      return {
        wouldPay: false,
        reason: "detection_failed",
        quote: quoteInfo,
      };
    }

    const amountInUsd = this.budgetManager.convertToUsd(selectedQuote.amount);
    const budgetCheck = this.budgetManager.checkTransaction(amountInUsd);
    const budgetState = this.budgetManager.getState();

    if (budgetCheck.exceeded) {
      return {
        wouldPay: false,
        reason: "budget_exceeded",
        quote: quoteInfo,
        budgetCheck: {
          allowed: false,
          dailyRemaining: budgetState.dailyRemaining,
          monthlyRemaining: budgetState.monthlyRemaining,
          wouldExceed: budgetCheck.period,
        },
      };
    }

    let wallet: ResolvedWallet;
    try {
      wallet = this.selectWalletForPayment(selectedQuote, url);
    } catch (err) {
      if (err instanceof UnsupportedNetworkError) {
        return {
          wouldPay: false,
          reason: "unsupported_network",
          quote: quoteInfo,
          budgetCheck: {
            allowed: true,
            dailyRemaining: budgetState.dailyRemaining,
            monthlyRemaining: budgetState.monthlyRemaining,
            wouldExceed: null,
          },
        };
      }
      if (err instanceof NoWalletError) {
        return {
          wouldPay: false,
          reason: "no_wallet_for_network",
          quote: quoteInfo,
          budgetCheck: {
            allowed: true,
            dailyRemaining: budgetState.dailyRemaining,
            monthlyRemaining: budgetState.monthlyRemaining,
            wouldExceed: null,
          },
        };
      }
      return {
        wouldPay: false,
        reason: "network_error",
        quote: quoteInfo,
      };
    }

    return {
      wouldPay: true,
      quote: quoteInfo,
      budgetCheck: {
        allowed: true,
        dailyRemaining: budgetState.dailyRemaining,
        monthlyRemaining: budgetState.monthlyRemaining,
        wouldExceed: null,
      },
      wallet: {
        name: wallet.name,
        type: wallet.type,
      },
    };
  }

  private async probeOrPassthrough(
    url: string,
    options?: FetchOptions,
  ): Promise<readonly ProbeResult[] | BoltzPayResponse> {
    try {
      return await this.router.probeAll(url, options?.headers);
    } catch (err) {
      if (err instanceof ProtocolDetectionFailedError) {
        this.logger.debug(`No protocol detected for ${url}, passing through`);
        const response = await globalThis.fetch(url, {
          method: options?.method ?? "GET",
          headers: options?.headers,
          body: options?.body ? new Uint8Array(options.body) : undefined,
          signal: AbortSignal.timeout(PASSTHROUGH_TIMEOUT_MS),
        });

        if (response.status === 402) {
          const lateProbes = await this.router.probeFromResponse(
            response.clone(),
          );
          if (lateProbes.length > 0) {
            this.logger.debug(
              `Late detection: ${lateProbes[0]?.adapter.name} for ${url}`,
            );
            return lateProbes;
          }
        }

        return await BoltzPayResponse.fromFetch(response);
      }
      if (err instanceof BoltzPayError) {
        this.emitter.emit("error", err);
        throw err;
      }
      const protocolErr = this.wrapDetectionError(err);
      this.emitter.emit("error", protocolErr);
      throw protocolErr;
    }
  }

  private guardScheme(quote: ProtocolQuote, url: string): void {
    if (quote.scheme === "exact") return;
    this.emitter.emit("protocol:unsupported-scheme", {
      scheme: quote.scheme,
      maxAmount: quote.amount,
      network: quote.network,
      url,
    });
    throw new UnsupportedSchemeError({
      scheme: quote.scheme,
      maxAmount: quote.amount,
      network: quote.network,
    });
  }

  private selectPaymentChain(
    quote: ProtocolQuote,
    options?: FetchOptions,
  ): ProtocolQuote {
    if (!quote.allAccepts || quote.allAccepts.length === 0) {
      this.enforceChainOnSingleAccept(quote, options?.chain);
      return quote;
    }
    return this.selectFromMultipleAccepts(quote, options);
  }

  private enforceChainOnSingleAccept(
    quote: ProtocolQuote,
    chain: ChainNamespace | undefined,
  ): void {
    if (!chain || !quote.network) return;
    const parsed = this.tryParseNetwork(quote.network);
    if (!parsed) return;
    if (parsed.namespace !== chain) {
      throw new ProtocolError(
        "no_compatible_chain",
        `Requested chain "${chain}" but endpoint only supports "${parsed.namespace}" (${quote.network})`,
      );
    }
  }

  private tryParseNetwork(
    network: string,
  ): ReturnType<typeof parseNetworkIdentifier> | undefined {
    try {
      return parseNetworkIdentifier(network);
    } catch {
      // Intent: non-standard network identifier — treat as unknown rather than crashing
      return undefined;
    }
  }

  private selectFromMultipleAccepts(
    quote: ProtocolQuote,
    options?: FetchOptions,
  ): ProtocolQuote {
    const accepts = quote.allAccepts ?? [];
    try {
      const capabilities: ChainCapabilities = {
        supportedNamespaces: this.getPayableNamespaces(),
        preferredChains: options?.chain
          ? [options.chain]
          : (this.config.preferredChains ?? []),
      };
      const bestAccept = selectBestAccept(accepts, capabilities);

      if (options?.chain && bestAccept.namespace !== options.chain) {
        const available = [...new Set(accepts.map((a) => a.namespace))];
        throw new ProtocolError(
          "no_compatible_chain",
          `Requested chain "${options.chain}" but endpoint only supports: ${available.join(", ")}`,
        );
      }

      return {
        ...quote,
        amount: Money.fromCents(bestAccept.amount),
        network: bestAccept.network,
        payTo: bestAccept.payTo,
        scheme: bestAccept.scheme,
      };
    } catch (err) {
      if (err instanceof NoCompatibleChainError) {
        throw new ProtocolError("no_compatible_chain", err.message);
      }
      throw err;
    }
  }

  private async executeWithWalletFallback(
    url: string,
    probeResults: readonly ProbeResult[],
    options: FetchOptions | undefined,
    fetchStart: number,
  ): Promise<BoltzPayResponse> {
    const errors: Error[] = [];
    const detectedProtocols: string[] = [];

    for (const probe of probeResults) {
      detectedProtocols.push(probe.adapter.name);

      let wallet: ResolvedWallet;
      let selectedQuote: ProtocolQuote;
      try {
        selectedQuote = this.selectPaymentChain(probe.quote, options);
        this.guardScheme(selectedQuote, url);
        wallet = this.selectWalletForPayment(selectedQuote, url);
      } catch (err) {
        if (err instanceof NoWalletError) {
          this.logger.debug(
            `Skipping ${probe.adapter.name}: no matching wallet configured`,
          );
          continue;
        }
        if (
          err instanceof UnsupportedSchemeError ||
          err instanceof UnsupportedNetworkError
        ) {
          throw err;
        }
        if (
          err instanceof ProtocolError &&
          err.code === "no_compatible_chain"
        ) {
          throw err;
        }
        errors.push(err instanceof Error ? err : new Error(String(err)));
        continue;
      }

      const result = await this.tryAdapter(
        { url, adapter: probe.adapter, quote: selectedQuote, options, wallet },
        errors,
        fetchStart,
      );
      if (result) return result;
    }

    if (errors.length === 0 && detectedProtocols.length > 0) {
      throw new NoWalletError(
        detectedProtocols.join(", "),
        this.getAvailableNetworksList(),
      );
    }

    const aggregateErr = new AggregatePaymentError(errors);
    const diagnosis = errors
      .filter(
        (e): e is ProtocolError => e instanceof ProtocolError && !!e.diagnosis,
      )
      .map((e) => e.diagnosis)[0];
    const wrapped = new ProtocolError(
      "payment_failed",
      aggregateErr.message,
      diagnosis,
    );
    this.emitter.emit("error", wrapped);
    throw wrapped;
  }

  private async tryAdapter(
    input: PaymentFlowInput,
    errors: Error[],
    fetchStart?: number,
  ): Promise<BoltzPayResponse | undefined> {
    try {
      return await this.executePaymentFlow(input, fetchStart);
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      if (err instanceof PaymentUncertainError) throw err;
      errors.push(err instanceof Error ? err : new Error(String(err)));
      this.logger.debug(`Adapter ${input.adapter.name} failed, trying next...`);
      return undefined;
    }
  }

  private async acquirePaymentLock(): Promise<() => void> {
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.paymentLock;
    this.paymentLock = next;
    await previous;
    return release;
  }

  private async executePaymentFlow(
    input: PaymentFlowInput,
    fetchStart?: number,
  ): Promise<BoltzPayResponse> {
    const release = await this.acquirePaymentLock();
    const { url, adapter, quote, options } = input;
    try {
      this.checkMaxAmount(quote, this.getEffectiveMaxAmount(options));
      this.checkBudget(quote);
      const result = await this.executeProtocolPayment(input);

      if (!result.success) {
        const serverMessage = extractServerMessage(result.responseBody);
        const diagnosis = diagnoseDeliveryFailure(
          result.responseStatus,
          serverMessage,
        );
        throw new ProtocolError(
          "payment_failed",
          `Payment was not accepted by the server (HTTP ${result.responseStatus})`,
          diagnosis,
        );
      }

      const budgetAmount = this.budgetManager.convertToUsd(quote.amount);
      this.budgetManager.recordSpending(budgetAmount);
      this.emitBudgetWarningIfNeeded();

      const durationMs = fetchStart ? Date.now() - fetchStart : undefined;
      return this.buildSuccessResponse({
        url,
        adapter,
        quote,
        result,
        durationMs,
      });
    } catch (err) {
      if (this.isPostSignatureNetworkError(err)) {
        const uncertain = new PaymentUncertainError({
          message: `Network error after payment signing — payment may have been sent. ${err instanceof Error ? err.message : ""}`,
          url,
          amount: quote.amount,
          protocol: adapter.name,
        });
        this.logger.error("PAYMENT UNCERTAIN — manual verification required", {
          url,
          amount: quote.amount.toDisplayString(),
          protocol: adapter.name,
          critical: true,
        });
        this.emitter.emit("payment:uncertain", {
          url,
          amount: quote.amount,
          protocol: adapter.name,
          error: uncertain,
        });
        throw uncertain;
      }
      if (err instanceof BoltzPayError) {
        throw err;
      }
      throw this.wrapProtocolError(err);
    } finally {
      release();
    }
  }

  // Intent: reuses ConfigurationError because the policy is user-configured.
  // Consumers switch on the stable code "domain_blocked", not the error class.
  // A dedicated DomainPolicyError would add a class for a single code — not warranted.
  private checkDomainPolicy(url: string): void {
    const hostname = new URL(url).hostname;
    const allowlist = this.config.allowlist;
    const blocklist = this.config.blocklist;

    if (allowlist && allowlist.length > 0) {
      const allowed = allowlist.some(
        (d) => hostname === d || hostname.endsWith(`.${d}`),
      );
      if (!allowed) {
        throw new ConfigurationError(
          "domain_blocked",
          `Domain "${hostname}" is not in the allowlist`,
        );
      }
      return;
    }

    if (blocklist && blocklist.length > 0) {
      const blocked = blocklist.some(
        (d) => hostname === d || hostname.endsWith(`.${d}`),
      );
      if (blocked) {
        throw new ConfigurationError(
          "domain_blocked",
          `Domain "${hostname}" is in the blocklist`,
        );
      }
    }
  }

  private getEffectiveMaxAmount(
    options?: FetchOptions,
  ): number | string | undefined {
    return options?.maxAmount ?? this.config.maxAmountPerRequest;
  }

  private checkMaxAmount(
    quote: ProtocolQuote,
    maxAmount: number | string | undefined,
  ): void {
    if (maxAmount === undefined) return;
    const amountInUsd = this.budgetManager.convertToUsd(quote.amount);
    const maxMoney = toMoney(maxAmount);
    if (amountInUsd.greaterThan(maxMoney)) {
      const err = new BudgetExceededError(
        "per_transaction_exceeded",
        amountInUsd,
        maxMoney,
      );
      this.emitter.emit("error", err);
      throw err;
    }
  }

  private checkBudget(quote: ProtocolQuote): void {
    const amountInUsd = this.budgetManager.convertToUsd(quote.amount);
    const budgetCheck = this.budgetManager.checkTransaction(amountInUsd);
    if (!budgetCheck.exceeded) {
      return;
    }
    const err = new BudgetExceededError(
      toBudgetExceededCode(budgetCheck.period),
      quote.amount,
      budgetCheck.limit,
    );
    this.emitter.emit("budget:exceeded", {
      requested: quote.amount,
      limit: budgetCheck.limit,
      period: budgetCheck.period,
    });
    this.emitter.emit("error", err);
    throw err;
  }

  private async executeProtocolPayment(
    input: PaymentFlowInput,
  ): Promise<ProtocolResult> {
    const { url, adapter, quote, options, wallet } = input;

    let executionAdapter = adapter;
    if (
      wallet?.cdpManager &&
      adapter.name === "x402" &&
      wallet.cdpManager !== this.primaryCdpManager
    ) {
      const validateUrl = (u: string) => {
        try {
          new URL(u);
        } catch {
          throw new ProtocolError("payment_failed", `Invalid URL: ${u}`);
        }
      };
      executionAdapter = new X402Adapter(
        wallet.cdpManager,
        validateUrl,
        this.config.timeouts,
      );
    }

    const executeRequest: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body: Uint8Array | undefined;
      amount: Money;
      wallet?: MppRawConfig;
    } = {
      url,
      method: options?.method ?? "GET",
      headers: options?.headers ?? {},
      body: options?.body,
      amount: quote.amount,
    };

    if (adapter.name === "mpp" && wallet?.rawConfig) {
      executeRequest.wallet = wallet.rawConfig;
    }

    return this.router.execute(executionAdapter, executeRequest);
  }

  private isPostSignatureNetworkError(err: unknown): boolean {
    if (err instanceof BoltzPayError) return false;
    if (!(err instanceof Error)) return false;

    const msg = err.message.toLowerCase();
    return POST_SIGNATURE_NETWORK_ERROR_PATTERNS.some((p) => msg.includes(p));
  }

  private emitBudgetWarningIfNeeded(): void {
    const check = this.budgetManager.checkWarning();
    if (check.warning) {
      this.emitter.emit("budget:warning", {
        spent: check.spent,
        limit: check.limit,
        period: check.period,
        usage: check.usage,
      });
    }
  }

  private buildSuccessResponse(input: SuccessResponseInput): BoltzPayResponse {
    const { url, adapter, quote, result, durationMs } = input;
    const protocol = adapter.name;
    const record: PaymentRecord = {
      id: crypto.randomUUID(),
      url,
      protocol,
      amount: quote.amount,
      timestamp: new Date(),
      txHash: result.externalTxHash,
      network: quote.network,
      durationMs,
    };
    this.history.add(record);
    this.emitter.emit("payment", record);

    const payment: PaymentDetails = {
      protocol: record.protocol,
      amount: record.amount,
      url: record.url,
      timestamp: record.timestamp,
      txHash: record.txHash,
    };
    return new BoltzPayResponse({
      ok: isSuccessStatus(result.responseStatus),
      status: result.responseStatus,
      headers: result.responseHeaders,
      rawBody: result.responseBody ?? new Uint8Array(),
      payment,
      protocol: record.protocol,
    });
  }

  private wrapProtocolError(err: unknown): BoltzPayError {
    if (err instanceof X402PaymentError) {
      const hasAttempts = (err.deliveryAttempts?.length ?? 0) > 0;
      const diagnosis: DeliveryDiagnosis = {
        phase: hasAttempts ? "delivery" : "payment",
        paymentSent: hasAttempts,
        suggestion: err.suggestion,
        deliveryAttempts: err.deliveryAttempts?.map((a) => ({
          method: a.method,
          headerName: a.headerName,
          status: a.status,
          serverMessage: a.serverMessage,
        })),
      };
      const wrapped = new ProtocolError(
        err.code as "x402_payment_failed",
        err.message,
        diagnosis,
      );
      this.emitter.emit("error", wrapped);
      return wrapped;
    }

    if (err instanceof AdapterError) {
      const wrapped = isProtocolErrorCode(err.code)
        ? new ProtocolError(err.code, err.message)
        : new NetworkError("blockchain_error", err.message);
      this.emitter.emit("error", wrapped);
      return wrapped;
    }

    const wrapped = new ProtocolError(
      "payment_failed",
      err instanceof Error ? err.message : "Unknown error during payment",
    );
    this.emitter.emit("error", wrapped);
    return wrapped;
  }

  private wrapDetectionError(err: unknown): BoltzPayError {
    if (err instanceof AdapterError) {
      return isProtocolErrorCode(err.code)
        ? new ProtocolError(err.code, err.message)
        : new NetworkError("endpoint_unreachable", err.message);
    }
    return new ProtocolError(
      "protocol_detection_failed",
      err instanceof Error ? err.message : "Detection failed",
    );
  }

  async diagnose(url: string): Promise<DiagnoseResult> {
    await this.initPromise;
    return diagnoseEndpoint({
      url,
      router: this.router,
      detectTimeoutMs: this.config.timeouts?.detect,
      registryUrl: this.config.registryUrl ?? DEFAULT_REGISTRY_URL,
    });
  }

  async quote(url: string): Promise<QuoteResult> {
    await this.initPromise;
    this.checkDomainPolicy(url);
    try {
      const { adapter, quote } = await withRetry(
        () => this.router.probe(url),
        this.buildRetryOptions("quote"),
      );
      return {
        amount: quote.amount,
        protocol: adapter.name,
        network: quote.network,
        allAccepts: quote.allAccepts,
        inputHints: quote.inputHints,
      };
    } catch (err) {
      if (err instanceof ProtocolDetectionFailedError) {
        throw new ProtocolError(
          "protocol_detection_failed",
          `No payment protocol detected for ${url}`,
        );
      }
      if (err instanceof BoltzPayError) throw err;
      throw this.wrapDetectionError(err);
    }
  }

  getBudget(): BudgetState {
    return this.budgetManager.getState();
  }

  resetDailyBudget(): void {
    this.budgetManager.resetDaily();
    this.logger.info("Daily budget reset");
  }

  getHistory(): readonly PaymentRecord[] {
    return this.history.getAll();
  }

  getMetrics(): PaymentMetrics {
    return computeMetrics(this.history.getAll(), this.errorCount);
  }

  exportHistory(format: "csv" | "json"): string {
    const records = this.history.getAll();
    return format === "csv" ? exportCSV(records) : exportJSON(records);
  }

  getCapabilities(): {
    network: string;
    protocols: string[];
    canPay: boolean;
    canPayLightning: boolean;
    chains: ChainNamespace[];
    addresses: { evm?: string; svm?: string };
  } {
    const hasCoinbase = this.wallets.some((w) => w.type === "coinbase");
    const hasNwc = this.wallets.some((w) => w.type === "nwc");
    const protocols: string[] = ["x402"];
    if (hasNwc) {
      protocols.push("l402");
    }
    const chains: ChainNamespace[] = [...this.getPayableNamespaces()];
    const addresses = this.primaryCdpManager?.getAddresses() ?? {};
    return {
      network: this.config.network,
      protocols,
      canPay: hasCoinbase,
      canPayLightning: hasNwc,
      chains,
      addresses,
    };
  }

  async getBalances(): Promise<{
    evm?: { address: string; balance: Money | undefined };
    svm?: { address: string; balance: Money | undefined };
  }> {
    if (!this.primaryCdpManager) {
      return {};
    }
    try {
      const balances = await this.primaryCdpManager.getBalances(
        this.config.network,
      );
      const result: {
        evm?: { address: string; balance: Money | undefined };
        svm?: { address: string; balance: Money | undefined };
      } = {};

      if (balances.evm) {
        result.evm = {
          address: balances.evm.address,
          balance:
            balances.evm.balanceUsdcCents !== undefined
              ? Money.fromCents(balances.evm.balanceUsdcCents)
              : undefined,
        };
      }

      if (balances.svm) {
        result.svm = {
          address: balances.svm.address,
          balance:
            balances.svm.balanceUsdcCents !== undefined
              ? Money.fromCents(balances.svm.balanceUsdcCents)
              : undefined,
        };
      }

      return result;
    } catch {
      // Intent: wallet balance query failure is non-fatal — return empty balances
      return {};
    }
  }

  async getWalletStatus(): Promise<WalletStatus> {
    const capabilities = this.getCapabilities();
    const budget = this.getBudget();
    const credentials = this.buildCredentialsStatus();
    const lightning = await this.buildLightningStatus();

    if (!this.primaryCdpManager) {
      return {
        network: capabilities.network,
        isTestnet: isTestnet(capabilities.network),
        protocols: capabilities.protocols,
        canPay: false,
        credentials,
        connection: {
          status: "skipped",
          reason: "Coinbase credentials not configured",
        },
        accounts: { evm: undefined, svm: undefined },
        budget,
        lightning,
      };
    }

    const { connection, accounts } = await this.buildConnectionAndAccounts(
      this.primaryCdpManager,
    );

    return {
      network: capabilities.network,
      isTestnet: isTestnet(capabilities.network),
      protocols: capabilities.protocols,
      canPay: true,
      credentials,
      connection,
      accounts,
      budget,
      lightning,
    };
  }

  private buildCredentialsStatus(): WalletStatus["credentials"] {
    return {
      coinbase: {
        configured: !!this.primaryCdpManager,
        keyHint: this.config.coinbaseApiKeyId
          ? maskKey(this.config.coinbaseApiKeyId)
          : undefined,
      },
    };
  }

  private async buildLightningStatus(): Promise<LightningStatus | undefined> {
    if (!this.primaryNwcManager) return undefined;

    try {
      const start = Date.now();
      const { balanceSats } = await this.primaryNwcManager.getBalance();
      const latencyMs = Date.now() - start;
      return {
        configured: true,
        connection: { status: "connected", latencyMs },
        balance: { sats: balanceSats, display: `${balanceSats} sats` },
      };
    } catch (err) {
      return {
        configured: true,
        connection: {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private async buildConnectionAndAccounts(
    walletManager: CdpWalletManager,
  ): Promise<{
    connection: WalletStatus["connection"];
    accounts: WalletStatus["accounts"];
  }> {
    const connectResult = await this.measureConnection(walletManager);
    if (connectResult.status === "error") {
      return {
        connection: connectResult,
        accounts: { evm: undefined, svm: undefined },
      };
    }

    const balances = await this.getBalances();
    return {
      connection: connectResult,
      accounts: {
        evm: this.toAccountEntry(balances.evm),
        svm: this.toAccountEntry(balances.svm),
      },
    };
  }

  private async measureConnection(
    walletManager: CdpWalletManager,
  ): Promise<WalletStatus["connection"]> {
    try {
      const start = Date.now();
      await walletManager.getOrProvisionEvmAccount();
      return { status: "connected", latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private toAccountEntry(
    balance: { address: string; balance: Money | undefined } | undefined,
  ): { address: string; balance: Money | undefined } | undefined {
    if (!balance) return undefined;
    return { address: balance.address, balance: balance.balance };
  }

  async discover(
    options?: DiscoverOptions,
  ): Promise<readonly DiscoveredEntry[]> {
    await this.initPromise;

    if (options?.minScore != null) {
      if (
        !Number.isFinite(options.minScore) ||
        options.minScore < 0 ||
        options.minScore > 100
      ) {
        throw new ConfigurationError(
          "invalid_config",
          "discover() minScore must be a finite number between 0 and 100",
        );
      }
    }
    if (options?.limit != null) {
      if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new ConfigurationError(
          "invalid_config",
          "discover() limit must be a positive integer",
        );
      }
    }
    if (options?.offset != null) {
      if (!Number.isInteger(options.offset) || options.offset < 0) {
        throw new ConfigurationError(
          "invalid_config",
          "discover() offset must be a non-negative integer",
        );
      }
    }

    const registryUrl = this.config.registryUrl ?? DEFAULT_REGISTRY_URL;
    const response = await fetchRegistryEndpoints(registryUrl, {
      protocol: options?.protocol,
      minScore: options?.minScore,
      category: options?.category,
      query: options?.query,
      limit: options?.limit,
      offset: options?.offset,
      signal: options?.signal,
    });
    return response.data;
  }

  /** Wraps a MCP Client with automatic MPP payment handling for -32042 errors. */
  async wrapMcpClient(client: {
    callTool(
      params: { name: string; arguments?: Record<string, unknown> },
      options?: unknown,
    ): Promise<unknown>;
  }): Promise<WrappedMcpClient> {
    const methods = await this.buildMcpPaymentMethods();
    if (methods.length === 0) {
      throw new ConfigurationError(
        "invalid_config",
        "wrapMcpClient requires at least one MPP wallet configured (tempo or stripe-mpp)",
      );
    }

    return createMcpPaymentWrapper({
      client,
      methods,
      budgetManager: this.budgetManager,
      emitter: this.emitter,
      history: this.history,
      convertToUsd: (amount) => this.budgetManager.convertToUsd(amount),
    });
  }

  private async buildMcpPaymentMethods(): Promise<
    import("mppx").Method.AnyClient[]
  > {
    const methods: import("mppx").Method.AnyClient[] = [];
    for (const wallet of this.wallets) {
      if (wallet.type === "tempo" || wallet.type === "stripe-mpp") {
        try {
          const method = await createMppMethod(
            wallet.type,
            wallet.rawConfig ?? {},
          );
          methods.push(method);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Skipping ${wallet.type} wallet "${wallet.name}": ${message}`,
          );
        }
      }
    }
    return methods;
  }

  close(): void {
    for (const w of this.wallets) {
      w.nwcManager?.close();
    }
  }

  on<E extends EventName>(event: E, listener: EventListener<E>): this {
    this.emitter.on(event, listener);
    return this;
  }

  off<E extends EventName>(event: E, listener: EventListener<E>): this {
    this.emitter.off(event, listener);
    return this;
  }
}
