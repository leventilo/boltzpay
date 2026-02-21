/**
 * Bazaar Discovery API integration — fetches live x402 endpoints
 * from the Coinbase CDP Bazaar Discovery service.
 *
 * Provides two modes:
 * - Static only (default): `getMergedDirectory({ live: false })`
 * - Live + static merged: `getMergedDirectory({ live: true })`
 */

import type { ApiDirectoryEntry } from "./directory";
import { API_DIRECTORY } from "./directory";

interface BazaarAccept {
  readonly network: string;
  readonly maxAmountRequired: number;
  readonly description?: string;
  readonly scheme?: string;
}

interface BazaarItem {
  readonly resource: string;
  readonly type: string;
  readonly accepts: readonly BazaarAccept[];
  readonly metadata?: { readonly description?: string };
  readonly lastUpdated?: string;
}

interface BazaarResponse {
  readonly x402Version: number;
  readonly items: readonly BazaarItem[];
  readonly pagination: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
}

const BAZAAR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const CACHE_TTL_MS = 5 * 60 * 1000;
const USDC_ATOMIC_PER_DOLLAR = 1_000_000;
const SUB_CENT_THRESHOLD = 10_000;
const SUB_CENT_DECIMALS = 4;
const STANDARD_DECIMALS = 2;

let cache: { data: readonly ApiDirectoryEntry[]; timestamp: number } | null =
  null;

/** Clear the in-memory Bazaar cache. Useful for testing. */
export function clearBazaarCache(): void {
  cache = null;
}

function nameFromUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname === "/" ? "" : ` — ${u.pathname}`;
    return `${host}${path}`;
  } catch {
    // Malformed URL from external Bazaar API — fall back to raw string
    return raw;
  }
}

function deriveChain(accepts: readonly BazaarAccept[]): string | undefined {
  if (accepts.length === 0) return undefined;

  const networks = new Set<string>();
  for (const a of accepts) {
    const n = a.network.toLowerCase();
    if (n.includes("solana")) {
      networks.add("Solana");
    } else {
      // eip155, base, ethereum, etc. — default to Base
      networks.add("Base");
    }
  }

  const sorted = [...networks].sort(); // deterministic ordering
  return sorted.join(" + ") || undefined;
}

function formatPricing(accepts: readonly BazaarAccept[]): string {
  const first = accepts[0];
  if (!first || first.maxAmountRequired <= 0) return "$0.00";

  // External Bazaar API provides USDC atomic units (6 decimals) as number —
  // Math.round ensures integer before division (display-only, not domain money)
  const atomic = Math.round(first.maxAmountRequired);
  const dollars = atomic / USDC_ATOMIC_PER_DOLLAR;
  const decimals =
    atomic < SUB_CENT_THRESHOLD ? SUB_CENT_DECIMALS : STANDARD_DECIMALS;
  return `$${dollars.toFixed(decimals)}`;
}

function mapBazaarItem(item: BazaarItem): ApiDirectoryEntry {
  return {
    name: nameFromUrl(item.resource),
    url: item.resource,
    protocol: "x402",
    category: "bazaar",
    description:
      item.metadata?.description ?? "x402 endpoint via Bazaar Discovery",
    pricing: formatPricing(item.accepts),
    chain: deriveChain(item.accepts),
  };
}

export interface FetchBazaarOptions {
  readonly limit?: number;
  readonly timeout?: number;
}

/**
 * Fetch live endpoints from the CDP Bazaar Discovery API.
 *
 * Returns `ApiDirectoryEntry[]` on success, `[]` on any failure (graceful).
 * Results are cached in-memory for 5 minutes.
 */
export async function fetchBazaarDirectory(
  options?: FetchBazaarOptions,
): Promise<readonly ApiDirectoryEntry[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  const limit = options?.limit ?? 200;
  const timeout = options?.timeout ?? 10_000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${BAZAAR_URL}?type=http&limit=${limit}`, {
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as BazaarResponse;
    const entries = (data.items ?? []).map(mapBazaarItem);

    cache = { data: entries, timestamp: Date.now() };
    return entries;
  } catch {
    return [];
  }
}

export interface MergedDirectoryOptions {
  readonly live?: boolean;
}

/**
 * Get the API directory, optionally merged with live Bazaar endpoints.
 *
 * - `live: false` (default): returns the static `API_DIRECTORY` only.
 * - `live: true`: fetches Bazaar, merges with static. Static entries take
 *   priority (deduplication by URL).
 */
export async function getMergedDirectory(
  options?: MergedDirectoryOptions,
): Promise<readonly ApiDirectoryEntry[]> {
  if (!options?.live) {
    return API_DIRECTORY;
  }

  const bazaarEntries = await fetchBazaarDirectory();

  if (bazaarEntries.length === 0) {
    return API_DIRECTORY;
  }

  const staticUrls = new Set(API_DIRECTORY.map((e) => e.url));
  const uniqueBazaar = bazaarEntries.filter((e) => !staticUrls.has(e.url));

  return [...API_DIRECTORY, ...uniqueBazaar];
}
