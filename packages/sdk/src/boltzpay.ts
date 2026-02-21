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
  SUPPORTED_NAMESPACES,
  selectBestAccept,
} from "@boltzpay/core";
import {
  AdapterError,
  AggregatePaymentError,
  type CdpMultiChainClient,
  CdpWalletManager,
  L402Adapter,
  NwcWalletManager,
  type ProbeResult,
  ProtocolRouter,
  X402Adapter,
  X402PaymentError,
} from "@boltzpay/protocols";
import { getMergedDirectory } from "./bazaar";
import type { BudgetLimits, BudgetState } from "./budget/budget-manager";
import { BudgetManager } from "./budget/budget-manager";
import { hasCoinbaseCredentials, validateConfig } from "./config/schema";
import type { BoltzPayConfig, ValidatedConfig } from "./config/types";
import type {
  ApiDirectoryEntry,
  DiscoveredEntry,
  DiscoverOptions,
} from "./directory";
import {
  classifyProbeError,
  DISCOVER_PROBE_TIMEOUT_MS,
  filterEntries,
  sortDiscoveredEntries,
  withTimeout,
} from "./directory";
import { BoltzPayError } from "./errors/boltzpay-error";
import { BudgetExceededError } from "./errors/budget-exceeded-error";
import { ConfigurationError } from "./errors/configuration-error";
import { NetworkError } from "./errors/network-error";
import type { DeliveryDiagnosis } from "./errors/protocol-error";
import { isProtocolErrorCode, ProtocolError } from "./errors/protocol-error";
import { TypedEventEmitter } from "./events/event-emitter";
import type { EventListener, EventName } from "./events/types";
import { PaymentHistory } from "./history/payment-history";
import type { PaymentDetails, PaymentRecord } from "./history/types";
import type { Logger } from "./logger/logger";
import { createLogger } from "./logger/logger";
import { isTestnet } from "./network-utils";
import { getDataDir } from "./persistence/storage";
import { BoltzPayResponse } from "./response/boltzpay-response";
import type { LightningStatus, WalletStatus } from "./wallet-status";

export interface FetchOptions {
  /**
   * Maximum amount in dollars. Accepts string ("1.50") or number (1.50).
   * Numbers are safe for any realistic amount; converted immediately via Money.fromDollars().
   * Prefer string to avoid IEEE 754 float rounding (e.g. "0.10" not 0.1).
   */
  maxAmount?: number | string;
  /** Additional request headers. */
  headers?: Record<string, string>;
  /** HTTP method. Default "GET". */
  method?: string;
  /** Request body as raw bytes. */
  body?: Uint8Array;
  /** Override chain selection for this request. Takes priority over config preferredChains. */
  chain?: ChainNamespace;
}

/** Price quote returned by `BoltzPay.quote()` — the cost to access a paid endpoint. */
export interface QuoteResult {
  amount: Money;
  protocol: string;
  network: string | undefined;
  allAccepts?: readonly AcceptOption[];
  /** Input hints from the 402 response — tells agents what parameters the endpoint expects. */
  inputHints?: EndpointInputHints;
}

interface PaymentFlowInput {
  readonly url: string;
  readonly adapter: ProtocolAdapter;
  readonly quote: ProtocolQuote;
  readonly options?: FetchOptions;
}

interface FallbackInput {
  readonly url: string;
  readonly probeResults: readonly ProbeResult[];
  readonly selectedQuote: ProtocolQuote;
  readonly options?: FetchOptions;
}

interface SuccessResponseInput {
  readonly url: string;
  readonly adapter: ProtocolAdapter;
  readonly quote: ProtocolQuote;
  readonly result: ProtocolResult;
}

type BudgetExceededCode =
  | "daily_budget_exceeded"
  | "monthly_budget_exceeded"
  | "per_transaction_exceeded";

const BUDGET_EXCEEDED_CODES = {
  daily: "daily_budget_exceeded",
  monthly: "monthly_budget_exceeded",
  per_transaction: "per_transaction_exceeded",
} as const satisfies Record<string, BudgetExceededCode>;

function toBudgetExceededCode(
  period: "daily" | "monthly" | "per_transaction",
): BudgetExceededCode {
  return BUDGET_EXCEEDED_CODES[period];
}

function toMoney(value: string | number): Money {
  const dollars = typeof value === "string" ? value : value.toFixed(2);
  return Money.fromDollars(dollars);
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

const PASSTHROUGH_TIMEOUT_MS = 30_000;

const SERVER_MESSAGE_MAX_LENGTH = 500;

function extractServerMessage(
  body: Uint8Array | undefined,
): string | undefined {
  if (!body || body.length === 0) return undefined;
  let text: string;
  try {
    text = new TextDecoder().decode(body);
  } catch {
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
  } catch {}

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

/**
 * Main SDK client. Wraps `fetch()` with automatic payment protocol detection,
 * wallet signing, budget enforcement, and payment history tracking.
 */
export class BoltzPay {
  private readonly router: ProtocolRouter;
  private readonly budgetManager: BudgetManager;
  private readonly history: PaymentHistory;
  private readonly emitter: TypedEventEmitter;
  private readonly logger: Logger;
  private readonly config: ValidatedConfig;
  private readonly walletManager: CdpWalletManager | undefined;
  private readonly lightningWallet: NwcWalletManager | undefined;
  private paymentLock: Promise<void> = Promise.resolve();

  /**
   * @throws ConfigurationError if the config is invalid or credentials are malformed.
   */
  constructor(config: BoltzPayConfig) {
    this.config = validateConfig(config);
    this.logger = createLogger(this.config.logLevel);

    if (this.config.nwcConnectionString) {
      this.lightningWallet = new NwcWalletManager(
        this.config.nwcConnectionString,
      );
    }

    if (hasCoinbaseCredentials(this.config)) {
      const validatedConfig = this.config;
      this.walletManager = new CdpWalletManager(async () => {
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
          apiKeyId: validatedConfig.coinbaseApiKeyId,
          apiKeySecret: validatedConfig.coinbaseApiKeySecret,
          walletSecret: validatedConfig.coinbaseWalletSecret,
        });
      }, "boltzpay-default");
    }

    this.router = new ProtocolRouter(this.createAdapters());
    this.budgetManager = this.createBudgetManager();
    this.emitter = new TypedEventEmitter();
    this.history = this.createPaymentHistory();

    if (this.config.network === "base-sepolia") {
      this.logger.warn("Running on testnet (base-sepolia)");
    }
  }

  private createAdapters(): ProtocolAdapter[] {
    const validateUrl = (url: string) => {
      try {
        new URL(url);
      } catch {
        throw new ProtocolError("payment_failed", `Invalid URL: ${url}`);
      }
    };

    const adapters: ProtocolAdapter[] = [
      new X402Adapter(this.walletManager, validateUrl),
      new L402Adapter(this.lightningWallet, validateUrl),
    ];
    return adapters;
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

  private createBudgetManager(): BudgetManager {
    const limits = this.createBudgetLimits();
    const persistence = this.config.persistence;
    if (!persistence?.enabled) {
      return new BudgetManager(limits);
    }
    const dir = getDataDir(persistence.directory);
    return new BudgetManager(limits, `${dir}/budget.json`);
  }

  private createPaymentHistory(): PaymentHistory {
    const persistence = this.config.persistence;
    if (!persistence?.enabled) {
      return new PaymentHistory();
    }
    const dir = getDataDir(persistence.directory);
    const filePath = `${dir}/history.jsonl`;
    return new PaymentHistory({
      persistence: {
        filePath,
        maxRecords: persistence.historyMaxRecords ?? 500,
      },
    });
  }

  /**
   * Fetch a URL, automatically detecting and paying any required protocol fee.
   * Returns the API response with optional payment metadata.
   *
   * @example
   * ```ts
   * const response = await agent.fetch("https://api.example.com/data");
   * const data = await response.json();
   * ```
   *
   * @throws ProtocolError on detection or payment failure.
   * @throws BudgetExceededError if the payment exceeds a configured budget limit.
   * @throws ConfigurationError if payment is required but credentials are missing.
   */
  async fetch(url: string, options?: FetchOptions): Promise<BoltzPayResponse> {
    this.logger.debug(`Fetching ${url}`);

    const probeResults = await this.probeOrPassthrough(url, options);
    if (probeResults instanceof BoltzPayResponse) {
      return probeResults;
    }

    const primary = probeResults[0];
    if (!primary) {
      throw new ProtocolError("protocol_detection_failed", "No probe results");
    }

    const selectedQuote = this.selectPaymentChain(primary.quote, options);
    return this.executeWithFallback({
      url,
      probeResults,
      selectedQuote,
      options,
    });
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
      const protocolErr = this.wrapDetectionError(err);
      this.emitter.emit("error", protocolErr);
      throw protocolErr;
    }
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
        supportedNamespaces: SUPPORTED_NAMESPACES,
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
      };
    } catch (err) {
      if (err instanceof NoCompatibleChainError) {
        throw new ProtocolError("no_compatible_chain", err.message);
      }
      throw err;
    }
  }

  private async executeWithFallback(
    input: FallbackInput,
  ): Promise<BoltzPayResponse> {
    const { url, probeResults, selectedQuote, options } = input;
    const errors: Error[] = [];
    for (let i = 0; i < probeResults.length; i++) {
      const probe = probeResults[i];
      if (!probe) continue;
      const quote = i === 0 ? selectedQuote : probe.quote;
      const result = await this.tryAdapter(
        { url, adapter: probe.adapter, quote, options },
        errors,
      );
      if (result) return result;
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
  ): Promise<BoltzPayResponse | undefined> {
    try {
      return await this.executePaymentFlow(input);
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      errors.push(err instanceof Error ? err : new Error(String(err)));
      this.logger.debug(`Adapter ${input.adapter.name} failed, trying next...`);
      return undefined;
    }
  }

  private async acquirePaymentLock(): Promise<() => void> {
    // Promise constructor runs synchronously — release is always assigned before use
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
  ): Promise<BoltzPayResponse> {
    const release = await this.acquirePaymentLock();
    const { url, adapter, quote, options } = input;
    try {
      this.checkMaxAmount(quote, options?.maxAmount);
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

      return this.buildSuccessResponse({ url, adapter, quote, result });
    } catch (err) {
      if (err instanceof BoltzPayError) {
        throw err;
      }
      throw this.wrapProtocolError(err);
    } finally {
      release();
    }
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
    const { url, adapter, quote, options } = input;
    return this.router.execute(adapter, {
      url,
      method: options?.method ?? "GET",
      headers: options?.headers ?? {},
      body: options?.body,
      amount: quote.amount,
    });
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
    const { url, adapter, quote, result } = input;
    const protocol = adapter.name;
    const record: PaymentRecord = {
      id: crypto.randomUUID(),
      url,
      protocol,
      amount: quote.amount,
      timestamp: new Date(),
      txHash: result.externalTxHash,
      network: quote.network,
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

  /**
   * Probe an endpoint and return the payment price without executing a payment.
   *
   * @example
   * ```ts
   * const quote = await agent.quote("https://api.example.com/data");
   * console.log(`Price: ${quote.amount.toDisplayString()}`);
   * ```
   *
   * @throws ProtocolError if no payment protocol is detected.
   */
  async quote(url: string): Promise<QuoteResult> {
    try {
      const { adapter, quote } = await this.router.probe(url);
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

  /** Return the current budget spending state (daily/monthly spent, limits, remaining). */
  getBudget(): BudgetState {
    return this.budgetManager.getState();
  }

  /** Reset the daily spending counter to zero. Does not affect monthly spending. */
  resetDailyBudget(): void {
    this.budgetManager.resetDaily();
    this.logger.info("Daily budget reset");
  }

  /** Return all payment records from this SDK instance (in-memory, resets on new instance). */
  getHistory(): readonly PaymentRecord[] {
    return this.history.getAll();
  }

  /** Return the configured network, protocols, chains, and cached addresses. */
  getCapabilities(): {
    network: string;
    protocols: string[];
    canPay: boolean;
    canPayLightning: boolean;
    chains: ChainNamespace[];
    addresses: { evm?: string; svm?: string };
  } {
    const protocols: string[] = ["x402"];
    if (this.lightningWallet) {
      protocols.push("l402");
    }
    const chains: ChainNamespace[] = [...SUPPORTED_NAMESPACES];
    const addresses = this.walletManager?.getAddresses() ?? {};
    return {
      network: this.config.network,
      protocols,
      canPay: !!this.walletManager,
      canPayLightning: !!this.lightningWallet,
      chains,
      addresses,
    };
  }

  /** Query balance per chain from the wallet manager. Degrades gracefully. */
  async getBalances(): Promise<{
    evm?: { address: string; balance: Money | undefined };
    svm?: { address: string; balance: Money | undefined };
  }> {
    if (!this.walletManager) {
      return {};
    }
    try {
      const balances = await this.walletManager.getBalances(
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
      // Intentional: balance fetching is best-effort, return empty on any failure
      return {};
    }
  }

  /** Comprehensive wallet health check — probes connectivity, fetches balances, reports credential status. */
  async getWalletStatus(): Promise<WalletStatus> {
    const capabilities = this.getCapabilities();
    const budget = this.getBudget();
    const credentials = this.buildCredentialsStatus();
    const lightning = await this.buildLightningStatus();

    if (!this.walletManager) {
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
      this.walletManager,
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
        configured: !!this.walletManager,
        keyHint: this.config.coinbaseApiKeyId
          ? maskKey(this.config.coinbaseApiKeyId)
          : undefined,
      },
    };
  }

  private async buildLightningStatus(): Promise<LightningStatus | undefined> {
    if (!this.lightningWallet) return undefined;

    try {
      const start = Date.now();
      const { balanceSats } = await this.lightningWallet.getBalance();
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

  /** Probe all known paid API endpoints and return their live status and verified prices. */
  async discover(
    options?: DiscoverOptions,
  ): Promise<readonly DiscoveredEntry[]> {
    const live = options?.enableLiveDiscovery ?? true;
    const allEntries = await getMergedDirectory({ live });
    const entries = filterEntries(allEntries, options?.category);
    const results = await Promise.all(
      entries.map((entry) => this.probeDirectoryEntry(entry, options?.signal)),
    );
    return sortDiscoveredEntries(results);
  }

  private async probeDirectoryEntry(
    entry: ApiDirectoryEntry,
    signal?: AbortSignal,
  ): Promise<DiscoveredEntry> {
    try {
      const result = await withTimeout(
        this.quote(entry.url),
        DISCOVER_PROBE_TIMEOUT_MS,
        signal,
      );
      return {
        ...entry,
        live: {
          status: "live",
          livePrice: result.amount.toDisplayString(),
          protocol: result.protocol,
          network: result.network,
        },
      };
    } catch (err) {
      return { ...entry, live: classifyProbeError(err) };
    }
  }

  /**
   * Close underlying connections (NWC WebSocket, etc.) so the process can exit cleanly.
   * Safe to call multiple times.
   */
  close(): void {
    this.lightningWallet?.close();
  }

  /** Subscribe to SDK events: `"payment"`, `"error"`, `"budget:warning"`, `"budget:exceeded"`. */
  on<E extends EventName>(event: E, listener: EventListener<E>): this {
    this.emitter.on(event, listener);
    return this;
  }

  /** Unsubscribe from SDK events. */
  off<E extends EventName>(event: E, listener: EventListener<E>): this {
    this.emitter.off(event, listener);
    return this;
  }
}
