import type { Money } from "./money.vo";
import { InvalidNetworkIdentifierError } from "./payment-errors";

/** Supported chain namespaces at domain level. */
const SUPPORTED_NAMESPACES = ["evm", "svm"] as const;
type ChainNamespace = (typeof SUPPORTED_NAMESPACES)[number];

/** Parsed CAIP-2 network identifier. */
interface NetworkIdentifier {
  readonly namespace: ChainNamespace;
  readonly reference: string;
}

/** A single payment accept option from a protocol endpoint. */
interface AcceptOption {
  readonly namespace: ChainNamespace;
  readonly network: string;
  /** Amount in USD cents (bigint). Adapters convert from protocol-native units at the boundary. */
  readonly amount: bigint;
  readonly payTo: string;
  readonly asset: string;
  readonly scheme: string;
}

/** Wallet addresses per chain namespace. */
interface WalletInfo {
  readonly evm?: { readonly address: string; readonly balance?: Money };
  readonly svm?: { readonly address: string; readonly balance?: Money };
}

/** What chains the SDK instance can pay on. */
interface ChainCapabilities {
  readonly supportedNamespaces: readonly ChainNamespace[];
  readonly preferredChains: readonly ChainNamespace[];
}

const CAIP_TO_NAMESPACE: Record<string, ChainNamespace> = {
  eip155: "evm",
  solana: "svm",
};

const NAMESPACE_TO_CAIP: Record<ChainNamespace, string> = {
  evm: "eip155",
  svm: "solana",
};

const EVM_REFERENCE_PATTERN = /^\d+$/;
const SOLANA_REFERENCE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Parse a CAIP-2 string (e.g. "eip155:8453") into a NetworkIdentifier. */
function parseNetworkIdentifier(caip2: string): NetworkIdentifier {
  if (!caip2) {
    throw new InvalidNetworkIdentifierError(caip2 ?? "");
  }

  const colonIndex = caip2.indexOf(":");
  if (colonIndex === -1) {
    throw new InvalidNetworkIdentifierError(caip2);
  }

  const caipPrefix = caip2.slice(0, colonIndex);
  const reference = caip2.slice(colonIndex + 1);

  if (!reference) {
    throw new InvalidNetworkIdentifierError(caip2);
  }

  const namespace = CAIP_TO_NAMESPACE[caipPrefix];
  if (!namespace) {
    throw new InvalidNetworkIdentifierError(caip2);
  }

  if (namespace === "evm" && !EVM_REFERENCE_PATTERN.test(reference)) {
    throw new InvalidNetworkIdentifierError(caip2);
  }

  if (namespace === "svm" && !SOLANA_REFERENCE_PATTERN.test(reference)) {
    throw new InvalidNetworkIdentifierError(caip2);
  }

  return { namespace, reference };
}

/** Format a NetworkIdentifier back to CAIP-2 string (e.g. "eip155:8453"). */
function formatNetworkIdentifier(id: NetworkIdentifier): string {
  const caipPrefix = NAMESPACE_TO_CAIP[id.namespace];
  return `${caipPrefix}:${id.reference}`;
}

export {
  SUPPORTED_NAMESPACES,
  type ChainNamespace,
  type NetworkIdentifier,
  type AcceptOption,
  type WalletInfo,
  type ChainCapabilities,
  parseNetworkIdentifier,
  formatNetworkIdentifier,
};
