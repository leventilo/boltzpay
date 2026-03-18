import type { DiagnoseResult } from "./diagnostics/diagnose";
import { NetworkError } from "./errors/network-error";
import { ProtocolError } from "./errors/protocol-error";

const REMOTE_DIRECTORY_URL =
  "https://raw.githubusercontent.com/leventilo/boltzpay/main/directory.json";
const DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const DIRECTORY_FETCH_TIMEOUT_MS = 5_000;

let directoryCache: {
  data: readonly ApiDirectoryEntry[];
  timestamp: number;
} | null = null;

/** Clear the in-memory remote directory cache. Useful for testing. */
export function clearDirectoryCache(): void {
  directoryCache = null;
}

/**
 * Fetch the API directory from GitHub (cached for 5 minutes).
 * Falls back to the embedded static `API_DIRECTORY` on any failure.
 */
export async function fetchRemoteDirectory(): Promise<
  readonly ApiDirectoryEntry[]
> {
  if (
    directoryCache &&
    Date.now() - directoryCache.timestamp < DIRECTORY_CACHE_TTL_MS
  ) {
    return directoryCache.data;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      DIRECTORY_FETCH_TIMEOUT_MS,
    );

    const response = await fetch(REMOTE_DIRECTORY_URL, {
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return API_DIRECTORY;
    }

    const data = (await response.json()) as ApiDirectoryEntry[];
    directoryCache = { data, timestamp: Date.now() };
    return data;
  } catch {
    return API_DIRECTORY;
  }
}

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
    name: "CoinGecko — On-Chain Token Price",
    url: "https://pro-api.coingecko.com/api/v3/x402/onchain/simple/networks/base/token_price/0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf",
    protocol: "x402",
    category: "crypto-data",
    description:
      "DEX token price and market data on-chain via CoinGecko Pro (pass token contract address)",
    pricing: "$0.01",
  },
  {
    name: "Neynar — Farcaster Users",
    url: "https://api.neynar.com/v2/farcaster/user/bulk?fids=1",
    protocol: "x402",
    category: "social",
    description: "Farcaster user profiles in bulk (pass ?fids=1,2,3)",
    pricing: "$0.01",
  },
  {
    name: "Ordiscan — BRC-20 Token",
    url: "https://api.ordiscan.com/v1/brc20/ordi",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Bitcoin BRC-20 token data — supply, holders, deploy info (replace slug in URL)",
    pricing: "$0.01",
  },
  {
    name: "Ordiscan — Rune Data",
    url: "https://api.ordiscan.com/v1/rune/UNCOMMON•GOODS",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Bitcoin Runes data — supply, mints, etching info (replace name in URL)",
    pricing: "$0.01",
  },
  {
    name: "Nansen — Smart Money Netflow",
    url: "https://api.nansen.ai/api/v1/smart-money/netflow",
    protocol: "x402",
    category: "crypto-data",
    description: "Smart money net flow data from Nansen analytics",
    pricing: "$0.05",
  },
  {
    name: "Invy — Token Holdings",
    url: "https://invy.bot/api",
    protocol: "x402",
    category: "crypto-data",
    description: "Token holdings lookup across Base, Ethereum, and Solana",
    pricing: "$0.05",
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
    name: "x402-tools — Polymarket Trending",
    url: "https://x402-tools.vercel.app/api/polymarket/trending",
    protocol: "x402",
    category: "crypto-data",
    description: "Trending prediction markets from Polymarket",
    pricing: "$0.01",
  },
  {
    name: "911fund — Trending Alpha",
    url: "https://x402.911fund.io/alpha/trending",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Trending tokens, sectors, narrative clustering, and social momentum",
    pricing: "$0.03",
  },
  {
    name: "Crypto Enrichment — Price",
    url: "https://crypto-enrichment-api-production.up.railway.app/api/v1/price/BTC",
    protocol: "x402",
    category: "crypto-data",
    description: "Crypto price with 24h stats (replace symbol in URL)",
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
    name: "x402scan — Top Merchants",
    url: "https://x402scan-j55w7ornb-merit-systems.vercel.app/api/data/merchants",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Top x402 merchants by transaction volume (pass ?page=0&page_size=5&sort_by=volume)",
    pricing: "$0.01",
  },
  {
    name: "OttoAI — Token Security Audit",
    url: "https://x402.ottoai.services/token-security",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Token security scan — honeypot, rug pull, proxy detection (pass ?address=0x...&chain=8453)",
    pricing: "$0.10",
  },
  {
    name: "Agent Trust — Batch Score",
    url: "https://agent-trust-api-production.up.railway.app/score/batch",
    protocol: "x402",
    category: "crypto-data",
    description: "Batch wallet trust scoring for up to 10 Base addresses",
    pricing: "$0.03",
  },
  {
    name: "Capminal — Token Research",
    url: "https://www.capminal.ai/api/x402/research",
    protocol: "x402",
    category: "crypto-data",
    description: "AI-powered token deep research and analysis",
    pricing: "$0.01",
  },
  {
    name: "Polynews — Trade Feed",
    url: "https://polynews.news/api/v1/feed",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Real-time trade stream and market summaries ($500+ trades, 2hr window)",
    pricing: "$0.01",
  },
  {
    name: "Finance Data — Stock Price",
    url: "https://finance-data-api-production.up.railway.app/api/v1/stocks/price/AAPL",
    protocol: "x402",
    category: "finance",
    description: "Real-time stock price with key stats (replace symbol in URL)",
    pricing: "$0.02",
  },
  {
    name: "Finance Data — Forex Rate",
    url: "https://finance-data-api-production.up.railway.app/api/v1/forex/rate/EUR-USD",
    protocol: "x402",
    category: "finance",
    description: "Forex exchange rate (replace pair in URL)",
    pricing: "$0.01",
  },
  {
    name: "brapi — Stock Quotes",
    url: "https://brapi.dev/api/x402/stock-quotes",
    protocol: "x402",
    category: "finance",
    description: "Brazilian stock exchange quotes via x402",
    pricing: "$0.01",
  },
  {
    name: "Sports Arbitrage — Opportunities",
    url: "https://sportsarbitrageapi-production.up.railway.app/api/opportunities/sport",
    protocol: "x402",
    category: "finance",
    description:
      "Sports betting arbitrage opportunities (Soccer, NBA, Tennis, NFL, MLB)",
    pricing: "$0.03",
  },
  {
    name: "Gloria AI — Crypto News",
    url: "https://api.itsgloria.ai/news",
    protocol: "x402",
    category: "research",
    description: "Crypto news headlines with AI curation",
    pricing: "$0.03",
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
    name: "Hugen Scout — Intelligence Report",
    url: "https://scout.hugen.tokyo/scout/report",
    protocol: "x402",
    category: "research",
    description:
      "Multi-source intelligence report from HN, GitHub, npm, PyPI (pass ?q=search+terms)",
    pricing: "$0.01",
  },
  {
    name: "Agentutil — Fact Verification",
    url: "https://verify.agentutil.net/v1/verify",
    protocol: "x402",
    category: "research",
    description:
      "Fact verification with verdict, confidence score, and current truth",
    pricing: "$0.01",
  },
  {
    name: "x402search — API Search",
    url: "https://x402search.xyz/v1/search",
    protocol: "x402",
    category: "dev-tools",
    description: "Search 13,000+ indexed x402 APIs (POST JSON)",
    pricing: "$0.01",
  },
  {
    name: "Twit.sh — Twitter Search",
    url: "https://x402.twit.sh/tweets/search",
    protocol: "x402",
    category: "social",
    description:
      "Twitter/X tweet search via x402 (8 endpoints: tweets, users, followers, lists)",
    pricing: "$0.01",
  },
  {
    name: "Minifetch — URL to Markdown",
    url: "https://minifetch.com/api/v1/x402/extract/url-content",
    protocol: "x402",
    category: "ai-tools",
    description:
      "Extract clean markdown from any URL — token-efficient for LLM consumption",
    pricing: "$0.01",
  },
  {
    name: "Browserbase — Headless Browser",
    url: "https://x402.browserbase.com/browser/session/create",
    protocol: "x402",
    category: "dev-tools",
    description: "Create headless Chromium browser sessions on demand",
    pricing: "$0.01",
  },
  {
    name: "GenBase — Sora2 Video",
    url: "https://www.genbase.fun/api/video/create-sora2",
    protocol: "x402",
    category: "ai-tools",
    description: "AI video generation powered by Sora 2",
    pricing: "$0.20",
  },
  {
    name: "x402-api — DeFi Price Feed",
    url: "https://x402-api.fly.dev/api/price-feed",
    protocol: "x402",
    category: "crypto-data",
    description:
      "Crypto price feed BTC/ETH/SOL with top movers (8 DeFi endpoints available)",
    pricing: "$0.01",
  },
  {
    name: "HTTPay — Crypto News",
    url: "https://httpay.xyz/api/news/crypto",
    protocol: "x402",
    category: "research",
    description:
      "Crypto news RSS aggregation (4 endpoints: news, gas, MEV, yield)",
    pricing: "$0.01",
  },
  {
    name: "Lavarnd — Hardware Entropy",
    url: "https://lavarnd.up.railway.app/lava-entropy",
    protocol: "x402",
    category: "utilities",
    description: "Hardware-generated random entropy from lava lamp",
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
    name: "Auor — Public Holidays",
    url: "https://api.auor.io/open-holidays/v1/public",
    protocol: "x402",
    category: "utilities",
    description:
      "Public holiday calendar by country and year (pass ?country=FR&year=2026)",
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
    name: "SlamAI — Token Price",
    url: "https://api.slamai.dev/token/price",
    protocol: "x402",
    category: "crypto-data",
    description: "Token prices with FDV, liquidity, and 24h change",
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
    name: "SkillfulAI — Demo Premium",
    url: "https://api-dev.agents.skillfulai.io/api/x402/demo/mainnet/premium",
    protocol: "x402",
    category: "demo",
    description: "Demo premium endpoint with payment verification details",
    pricing: "$0.01",
  },
  {
    name: "SatsAPI — Bitcoin Price",
    url: "https://satsapi.dev/v1/price",
    protocol: "l402",
    category: "crypto-data",
    description:
      "Real-time Bitcoin price via Lightning L402 (8 endpoints: price, mempool, news, signal, etc.)",
    pricing: "3 sats",
  },
  {
    name: "SatsAPI — Trading Signal",
    url: "https://satsapi.dev/v1/signal",
    protocol: "l402",
    category: "crypto-data",
    description: "AI-powered Bitcoin trading signals via Lightning",
    pricing: "150 sats",
  },
  {
    name: "l402.services — GeoIP",
    url: "https://l402.services/geoip/8.8.8.8",
    protocol: "l402",
    category: "utilities",
    description:
      "IP geolocation — country, city, ISP, coordinates (replace IP in URL)",
    pricing: "1 sat",
  },
  {
    name: "l402.services — Lightning Search",
    url: "https://l402.services/ln/search?q=acinq",
    protocol: "l402",
    category: "crypto-data",
    description:
      "Search Lightning Network nodes by alias (18 LN endpoints available)",
    pricing: "10 sats",
  },
  {
    name: "l402.services — Prediction Markets",
    url: "https://l402.services/predictions/markets",
    protocol: "l402",
    category: "crypto-data",
    description: "Polymarket prediction markets data via Lightning",
    pricing: "10 sats",
  },
  {
    name: "Hyperdope — Video Streaming",
    url: "https://hyperdope.com/api/l402/videos/test/master.m3u8",
    protocol: "l402",
    category: "media",
    description: "HLS video streaming gated by Lightning L402 payment",
    pricing: "10 sats",
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

export function toDiscoverStatus(
  result: DiagnoseResult,
): DiscoverEntryStatus {
  switch (result.classification) {
    case "paid":
      return {
        status: "live",
        livePrice: result.price?.toDisplayString() ?? "unknown",
        protocol: result.protocol ?? "unknown",
        network: result.network,
      };
    case "free_confirmed":
      return { status: "free" };
    case "dead":
      return { status: "offline", reason: result.deathReason ?? "unknown" };
    case "ambiguous":
      return { status: "error", reason: "Ambiguous — 402 without valid payment options" };
  }
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
