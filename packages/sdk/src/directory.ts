import { NetworkError } from "./errors/network-error";
import { ProtocolError } from "./errors/protocol-error";

/** A paid API endpoint entry in the static directory. */
export interface ApiDirectoryEntry {
  readonly name: string;
  readonly url: string;
  readonly protocol: string;
  readonly category: string;
  readonly description: string;
  readonly pricing: string;
  readonly chain?: string;
  readonly status?: "live" | "testnet";
}

/** Probe result status for a directory entry — live (with verified price), free, offline, or error. */
export type DiscoverEntryStatus =
  | {
      readonly status: "live";
      readonly livePrice: string;
      readonly protocol: string;
      readonly network: string | undefined;
    }
  | { readonly status: "free" }
  | { readonly status: "offline"; readonly reason: string }
  | { readonly status: "error"; readonly reason: string };

/** Directory entry enriched with live probe status from `BoltzPay.discover()`. */
export interface DiscoveredEntry extends ApiDirectoryEntry {
  readonly live: DiscoverEntryStatus;
}

/** Options for `BoltzPay.discover()`. */
export interface DiscoverOptions {
  readonly category?: string;
  readonly signal?: AbortSignal;
  /** Fetch live endpoints from Bazaar Discovery API and merge with static directory. Default: true. */
  readonly enableLiveDiscovery?: boolean;
}

/** Static directory of known paid API endpoints compatible with BoltzPay. */
export const API_DIRECTORY: readonly ApiDirectoryEntry[] = [
  {
    name: "Invy — Token Holdings",
    url: "https://invy.bot/api",
    protocol: "x402",
    category: "crypto-data",
    description: "Token holdings lookup across Base, Ethereum, and Solana",
    pricing: "$0.05",
  },
  {
    name: "x402-tools — Polymarket Trending",
    url: "https://x402-tools.vercel.app/api/polymarket/trending",
    protocol: "x402",
    category: "crypto-data",
    description: "Trending prediction markets from Polymarket",
    pricing: "$0.01",
  },
  {
    name: "x402-tools — Concerts",
    url: "https://x402-tools.vercel.app/api/concerts",
    protocol: "x402",
    category: "utilities",
    description: "Event and concert discovery",
    pricing: "$0.01",
  },
  {
    name: "Einstein AI — Top Tokens",
    url: "https://emc2ai.io/x402/bitquery/top-tokens",
    protocol: "x402",
    category: "crypto-data",
    description: "Top tokens by market cap via Bitquery",
    pricing: "$0.55",
  },
  {
    name: "Einstein AI — Whale Intel",
    url: "https://emc2ai.io/x402/bitquery/whale-intel/raw",
    protocol: "x402",
    category: "crypto-data",
    description: "Whale wallet intelligence and tracking",
    pricing: "$0.85",
  },
  {
    name: "Nickel Joke (Testnet)",
    url: "https://nickeljoke.vercel.app/api/joke",
    protocol: "x402",
    category: "demo",
    description: "Joke API on Base Sepolia testnet — useful for E2E testing",
    pricing: "$0.005 (testnet)",
    status: "testnet",
  },
  {
    name: "Hello World",
    url: "https://hello-world-x402.vercel.app/hello",
    protocol: "x402",
    category: "demo",
    description:
      'Returns "Hello World" after payment — simplest x402 sanity test',
    pricing: "$0.01",
  },
  {
    name: "BoostPass Ping",
    url: "https://boostpass.qrbase.xyz/api/x402/ping",
    protocol: "x402",
    category: "demo",
    description: "Simple ping with payment confirmation and sender address",
    pricing: "$0.01",
  },
  {
    name: "Silverback — DeFi Top Protocols",
    url: "https://silverback-x402.onrender.com/api/v1/top-protocols",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Top DeFi protocols by TVL with multichain data (pass ?chain=base&limit=5)",
    pricing: "$0.01",
  },
  {
    name: "Auor — Public Holidays",
    url: "https://api.auor.io/open-holidays/v1/public",
    protocol: "x402",
    category: "utilities",
    description:
      "Public holiday calendar by country and year (pass ?country=FR&year=2026)",
    pricing: "$0.01",
  },
  {
    name: "SocioLogic — Cryptographic RNG",
    url: "https://rng.sociologic.ai/random/int",
    protocol: "x402",
    category: "utilities",
    description:
      "Cryptographically secure random integer (pass ?min=1&max=1000)",
    pricing: "$0.01",
  },
  {
    name: "x402scan — Top Merchants",
    url: "https://x402scan-j55w7ornb-merit-systems.vercel.app/api/data/merchants",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Top x402 merchants by transaction volume (pass ?page=0&page_size=5&sort_by=volume)",
    pricing: "$0.01",
  },
  {
    name: "PubMed Trends",
    url: "https://pubmed.sekgen.xyz/api/v1/trends",
    protocol: "x402",
    category: "research",
    description:
      "Academic publication trends from PubMed (pass ?query=CRISPR&start_year=2018&end_year=2025)",
    pricing: "$0.01",
  },
  {
    name: "SkillfulAI — Demo Premium",
    url: "https://api-dev.agents.skillfulai.io/api/x402/demo/mainnet/premium",
    protocol: "x402",
    category: "demo",
    description: "Demo premium endpoint with payment verification details",
    pricing: "$0.01",
  },
  {
    name: "OttoAI — Token Security Audit",
    url: "https://x402.ottoai.services/token-security",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Token security scan powered by GoPlus — honeypot, rug pull, proxy detection (pass ?address=0x...&chain=8453)",
    pricing: "$0.01",
  },
  {
    name: "Grapevine — IPFS Gateway",
    url: "https://gateway.grapevine.fyi/x402/cid/bafkreib7s7xuwc57wri43lyauwjeyfx3zqyc4ue34td5o7ab6wxp7sbqhm",
    protocol: "x402",
    category: "utilities",
    description: "IPFS content retrieval via x402 payment gateway",
    pricing: "$0.01",
  },
  {
    name: "Creative-Tim — Shadcn Blocks",
    url: "https://x402.creative-tim.com/shadcn-blocks/user-payment",
    protocol: "x402",
    category: "dev-tools",
    description:
      "View Shadcn UI component source code after payment (pass ?block_name=testimonials-02)",
    pricing: "$0.01",
  },

  {
    name: "Zapper — Token Ranking",
    url: "https://public.zapper.xyz/x402/token-ranking",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Trending tokens ranked by swap activity and adoption velocity (POST JSON: {first, fid?})",
    pricing: "$0.01",
  },
  {
    name: "Zapper — DeFi Balances",
    url: "https://public.zapper.xyz/x402/defi-balances",
    protocol: "x402",
    category: "crypto-data",
    description:
      "DeFi positions (LP, lending, yield) for wallet addresses (POST JSON: {addresses, chainIds?, first?})",
    pricing: "$0.01",
  },
  {
    name: "Zapper — Transaction History",
    url: "https://public.zapper.xyz/x402/transaction-history",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Transaction history with interpretations for wallet addresses (POST JSON: {subjects, first?})",
    pricing: "$0.01",
  },

  {
    name: "Hugen Scout — Intelligence Report",
    url: "https://scout.hugen.tokyo/scout/report",
    protocol: "x402",
    category: "research",
    description:
      "Multi-source intelligence report from HN, GitHub, npm, PyPI (pass ?q=search+terms)",
    pricing: "$0.01",
  },

  {
    name: "Satring — Analytics",
    url: "https://satring.com/api/v1/analytics",
    protocol: "l402",
    category: "crypto-data",
    description:
      "Bitcoin and Lightning network analytics (90 services, categories, pricing)",
    pricing: "100 sats",
  },
  {
    name: "Satring — Service Reputation",
    url: "https://satring.com/api/v1/services/lightning-faucet-fortune/reputation",
    protocol: "l402",
    category: "crypto-data",
    description:
      "Detailed reputation report for L402 services (replace slug in URL)",
    pricing: "100 sats",
  },

  {
    name: "MaximumSats — BOLT11 Decoder",
    url: "https://maximumsats.com/api/bolt11-decode",
    protocol: "l402",
    category: "crypto-data",
    description:
      "Decode Lightning BOLT11 invoices into structured fields (amount, expiry, description hash, route hints)",
    pricing: "10 sats",
  },
  {
    name: "MaximumSats — NIP-05 Verifier",
    url: "https://maximumsats.com/api/nip05-verify",
    protocol: "l402",
    category: "crypto-data",
    description:
      "Verify Nostr NIP-05 identities from nostr.json — check if an npub maps to a valid lightning address",
    pricing: "20 sats",
  },
  {
    name: "MaximumSats — Web of Trust Report",
    url: "https://maximumsats.com/api/wot-report",
    protocol: "l402",
    category: "crypto-data",
    description:
      "Nostr Web of Trust analysis via PageRank — check trust scores, detect sybils, verify identities",
    pricing: "100 sats",
  },
  {
    name: "MaximumSats — npub Decoder",
    url: "https://maximumsats.com/api/npub-decode",
    protocol: "l402",
    category: "dev-tools",
    description:
      "Convert Nostr npub bech32 identifiers to hex pubkeys — essential for Nostr integration",
    pricing: "5 sats",
  },
  {
    name: "MaximumSats — Lightning Address Resolver",
    url: "https://maximumsats.com/api/lnurlp-resolve",
    protocol: "l402",
    category: "crypto-data",
    description:
      "Resolve Lightning Addresses to LNURL-pay metadata — get min, max, comment allowed",
    pricing: "15 sats",
  },
] as const;

/** All distinct categories present in the directory. */
export function getDirectoryCategories(): string[] {
  return [...new Set(API_DIRECTORY.map((e) => e.category))];
}

export const DISCOVER_PROBE_TIMEOUT_MS = 5_000;

/** Filter the static API directory by category. Returns all entries if no category given. */
export function filterDirectory(
  category?: string,
): readonly ApiDirectoryEntry[] {
  if (!category) return API_DIRECTORY;
  const lower = category.toLowerCase();
  return API_DIRECTORY.filter((e) => e.category === lower);
}

/** Filter an arbitrary array of entries by category. Returns all if no category given. */
export function filterEntries(
  entries: readonly ApiDirectoryEntry[],
  category?: string,
): readonly ApiDirectoryEntry[] {
  if (!category) return entries;
  const lower = category.toLowerCase();
  return entries.filter((e) => e.category === lower);
}

export function classifyProbeError(err: unknown): DiscoverEntryStatus {
  if (
    err instanceof ProtocolError &&
    err.code === "protocol_detection_failed"
  ) {
    return { status: "free" };
  }
  if (err instanceof NetworkError) {
    return { status: "offline", reason: err.message };
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return { status: "offline", reason: "Timeout" };
  }
  if (err instanceof Error && err.name === "AbortError") {
    return { status: "offline", reason: "Aborted" };
  }
  return {
    status: "error",
    reason: err instanceof Error ? err.message : String(err),
  };
}

const STATUS_ORDER: Record<DiscoverEntryStatus["status"], number> = {
  live: 0,
  offline: 1,
  error: 2,
  free: 3,
};

export function sortDiscoveredEntries(
  entries: readonly DiscoveredEntry[],
): readonly DiscoveredEntry[] {
  return [...entries].sort(
    (a, b) => STATUS_ORDER[a.live.status] - STATUS_ORDER[b.live.status],
  );
}

/** Flat JSON-serializable representation of a discovered entry for CLI/MCP output. */
export interface DiscoverJsonEntry {
  readonly name: string;
  readonly url: string;
  readonly description: string;
  readonly protocol: string;
  readonly category: string;
  readonly status: DiscoverEntryStatus["status"];
  readonly price: string;
  readonly isPriceVerified: boolean;
  readonly detectedProtocol?: string;
  readonly network?: string;
  readonly reason?: string;
}

/** Convert a DiscoveredEntry to a flat JSON-serializable object. */
export function toDiscoverJson(entry: DiscoveredEntry): DiscoverJsonEntry {
  const base = {
    name: entry.name,
    url: entry.url,
    description: entry.description,
    protocol: entry.protocol,
    category: entry.category,
    status: entry.live.status,
  } as const;

  switch (entry.live.status) {
    case "live":
      return {
        ...base,
        price: entry.live.livePrice,
        isPriceVerified: true,
        detectedProtocol: entry.live.protocol,
        network: entry.live.network,
      };
    case "free":
      return { ...base, price: "Free", isPriceVerified: true };
    case "offline":
      return {
        ...base,
        price: entry.pricing,
        isPriceVerified: false,
        reason: entry.live.reason,
      };
    case "error":
      return {
        ...base,
        price: entry.pricing,
        isPriceVerified: false,
        reason: entry.live.reason,
      };
    default: {
      const _exhaustive: never = entry.live;
      return _exhaustive;
    }
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Timeout", "TimeoutError"));
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}
