export type {
  AcceptOption,
  ChainNamespace,
  EndpointInputHints,
  ProtocolType,
  WalletInfo,
} from "@boltzpay/core";
export { Money } from "@boltzpay/core";
export type { FetchOptions, QuoteResult } from "./boltzpay";
export { BoltzPay } from "./boltzpay";
export type { BudgetLimits, BudgetState } from "./budget/budget-manager";
export type {
  BoltzPayConfig,
  BudgetConfig,
  StorageConfig,
  ValidatedConfig,
  WalletConfig,
} from "./config/types";
export type {
  ChainInfo,
  DeathReason,
  DiagnoseInput,
  DiagnoseResult,
  DiagnoseTiming,
  EndpointClassification,
  EndpointHealth,
  FormatVersion,
  MppMethodDetail,
} from "./diagnostics/diagnose";
export { diagnoseEndpoint } from "./diagnostics/diagnose";
export type {
  DryRunFailureReason,
  DryRunResult,
} from "./diagnostics/dry-run";
export type {
  DeliveryDiagnosis,
  DiagnosisDeliveryAttempt,
} from "./errors/index";
export {
  BoltzPayError,
  BudgetExceededError,
  ConfigurationError,
  InsufficientFundsError,
  MppSessionBudgetError,
  MppSessionError,
  NetworkError,
  NoWalletError,
  PaymentUncertainError,
  ProtocolError,
  RateLimitError,
  UnsupportedNetworkError,
  UnsupportedSchemeError,
} from "./errors/index";
export type {
  BoltzPayEvents,
  BudgetExceededEvent,
  BudgetWarningEvent,
  EventListener,
  EventName,
  McpPaymentEvent,
  PaymentUncertainEvent,
  RetryAttemptEvent,
  RetryExhaustedEvent,
  SessionCloseEvent,
  SessionErrorEvent,
  SessionOpenEvent,
  SessionVoucherEvent,
  UnsupportedNetworkEvent,
  UnsupportedSchemeEvent,
  WalletSelectedEvent,
} from "./events/types";
export type { PaymentDetails, PaymentRecord } from "./history/types";
export type {
  McpPaymentReceipt,
  WrappedCallToolResult,
  WrappedMcpClient,
} from "./mcp-payment/mcp-payment-wrapper";
export type { PaymentMetrics } from "./metrics/metrics";
export { isTestnet, networkToShortName } from "./network-utils";
export { FileAdapter } from "./persistence/file-adapter";
export { MemoryAdapter } from "./persistence/memory-adapter";
export type { StorageAdapter } from "./persistence/storage-adapter";
export {
  DEFAULT_REGISTRY_URL,
  fetchRegistryEndpoints,
} from "./registry/registry-client";
export type {
  DiscoveredEntry,
  DiscoverOptions,
  RegistryEndpoint,
  RegistryFetchOptions,
  RegistryListResponse,
} from "./registry/registry-types";
export { BoltzPayResponse } from "./response/boltzpay-response";
export type { BoltzPaySessionParams } from "./session/boltzpay-session";
export { BoltzPaySession } from "./session/boltzpay-session";
export type {
  BoltzPaySessionOptions,
  SessionEvent,
  SessionReceipt,
  VoucherInfo,
} from "./session/session-types";
export type {
  AccountStatus,
  ConnectionStatus,
  CredentialStatus,
  LightningStatus,
  WalletStatus,
} from "./wallet-status";

export const VERSION = "0.2.1";
