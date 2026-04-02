import { resolve as dnsResolve } from "node:dns/promises";
import type {
  AcceptOption,
  EndpointInputHints,
  MppMethodQuote,
} from "@boltzpay/core";
import { Money } from "@boltzpay/core";
import type { MppChallenge, NegotiatedPayment } from "@boltzpay/protocols";
import {
  hasMppScheme,
  negotiatePayment,
  type ProtocolRouter,
  parseMppChallenges,
  usdcAtomicToCents,
} from "@boltzpay/protocols";

export type EndpointHealth = "healthy" | "degraded" | "dead";

export type EndpointClassification =
  | "paid"
  | "free_confirmed"
  | "dead"
  | "ambiguous";

export type DeathReason =
  | "dns_failure"
  | "http_404"
  | "http_405"
  | "http_5xx"
  | "timeout"
  | "tls_error";

export type FormatVersion =
  | "V1 body"
  | "V2 header"
  | "www-authenticate"
  | "mpp";

export interface ChainInfo {
  readonly namespace: string;
  readonly network: string;
  readonly price: Money;
  readonly payTo: string | undefined;
  readonly scheme: string;
}

export interface DiagnoseTiming {
  readonly detectMs: number;
  readonly quoteMs: number;
}

export interface MppMethodDetail {
  readonly method: string;
  readonly intent: string;
  readonly id: string | undefined;
  readonly expires: string | undefined;
  readonly rawAmount: string | undefined;
  readonly currency: string | undefined;
  readonly recipient: string | undefined;
  readonly chainId: number | undefined;
}

export interface DiagnoseResult {
  readonly url: string;
  readonly classification: EndpointClassification;
  readonly deathReason?: DeathReason;
  readonly httpStatus?: number;
  readonly isPaid: boolean;
  readonly protocol: string | undefined;
  readonly formatVersion: FormatVersion | undefined;
  readonly scheme: string | undefined;
  readonly network: string | undefined;
  readonly price: Money | undefined;
  readonly facilitator: string | undefined;
  readonly payTo: string | undefined;
  readonly health: EndpointHealth;
  readonly latencyMs: number;
  readonly postOnly: boolean;
  readonly chains?: readonly ChainInfo[];
  readonly rawAccepts?: readonly AcceptOption[];
  readonly inputHints?: EndpointInputHints;
  readonly timing?: DiagnoseTiming;
  readonly mppMethods?: readonly MppMethodDetail[];
}

const TRUNCATE_THRESHOLD = 13;
const TRUNCATE_PREFIX = 6;
const TRUNCATE_SUFFIX = 4;

export function truncateAddress(addr: string): string {
  if (addr.length <= TRUNCATE_THRESHOLD) return addr;
  return `${addr.slice(0, TRUNCATE_PREFIX)}...${addr.slice(-TRUNCATE_SUFFIX)}`;
}

const SLOW_THRESHOLD_MS = 1000;
const STELLAR_SLOW_THRESHOLD_MS = 5000;
const SUSPICIOUS_PRICE_THRESHOLD = Money.fromDollars("100.00");

export function classifyHealth(
  latencyMs: number,
  scheme: string | undefined,
  network: string | undefined,
  price?: Money,
): EndpointHealth {
  if (scheme && scheme !== "exact") return "degraded";
  if (
    price &&
    price.currency === "USD" &&
    price.greaterThan(SUSPICIOUS_PRICE_THRESHOLD)
  ) {
    return "degraded";
  }
  const isStellar = network?.startsWith("stellar") ?? false;
  const threshold = isStellar ? STELLAR_SLOW_THRESHOLD_MS : SLOW_THRESHOLD_MS;
  if (latencyMs >= threshold) return "degraded";
  return "healthy";
}

export function toFormatVersion(negotiation: NegotiatedPayment): FormatVersion {
  switch (negotiation.transport) {
    case "body":
      return "V1 body";
    case "header":
      return "V2 header";
    case "www-authenticate":
      return "www-authenticate";
    default: {
      const exhaustive: never = negotiation.transport;
      throw new Error(`Unknown transport: ${String(exhaustive)}`);
    }
  }
}

export function buildChains(
  accepts: readonly AcceptOption[] | undefined,
): ChainInfo[] | undefined {
  if (!accepts || accepts.length === 0) return undefined;
  return accepts.map((a) => ({
    namespace: a.namespace,
    network: a.network,
    price: Money.fromCents(a.amount),
    payTo: a.payTo,
    scheme: a.scheme,
  }));
}

export interface DiagnoseInput {
  readonly url: string;
  readonly router: ProtocolRouter;
  readonly detectTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

const DEFAULT_DETECT_TIMEOUT_MS = 10_000;

const DNS_BUDGET_FRACTION = 0.15;
const DNS_MIN_MS = 500;
const DNS_MAX_MS = 3_000;

const MAX_REDIRECTS = 5;

const POST_BUDGET_FRACTION = 0.4;
const POST_MIN_MS = 2_000;

const TLS_ERROR_RE = /tls|ssl|certificate/i;

function hasValidPaymentHeaders(response: Response): boolean {
  const xPayment = response.headers.get("x-payment");
  if (xPayment && isDecodableBase64Json(xPayment)) return true;

  const wwwAuth = response.headers.get("www-authenticate");
  if (wwwAuth && /X402|L402/i.test(wwwAuth)) return true;
  if (wwwAuth && hasMppScheme(wwwAuth)) return true;

  let hasX402Header = false;
  response.headers.forEach((_value, key) => {
    if (!hasX402Header && key.toLowerCase().startsWith("x402-")) {
      hasX402Header = true;
    }
  });
  return hasX402Header;
}

function isDecodableBase64Json(value: string): boolean {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    JSON.parse(decoded);
    return true;
  } catch {
    // Intent: malformed x-payment header should not trigger "paid" classification
    return false;
  }
}

function classifyFetchError(error: unknown): DeathReason {
  if (error instanceof Error && TLS_ERROR_RE.test(error.message)) {
    return "tls_error";
  }
  return "timeout";
}

async function resolveDns(
  hostname: string,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      dnsResolve(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    // Intent: DNS failure means endpoint is unreachable — caller handles the false return
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await globalThis.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

async function fetchFollowingRedirects(
  url: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const visited = new Set<string>();
  let currentUrl = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (visited.has(currentUrl)) {
      throw new Error(`Redirect cycle: ${currentUrl}`);
    }
    visited.add(currentUrl);
    const response = await timedFetch(
      currentUrl,
      { method: "GET", redirect: "manual" },
      timeoutMs,
      externalSignal,
    );
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    currentUrl = new URL(location, currentUrl).href;
  }
  throw new Error("Too many redirects");
}

export async function diagnoseEndpoint(
  input: DiagnoseInput,
): Promise<DiagnoseResult> {
  const { url, router, detectTimeoutMs, signal } = input;
  const totalBudget = detectTimeoutMs ?? DEFAULT_DETECT_TIMEOUT_MS;
  const totalStart = Date.now();

  const remainingBudget = () =>
    Math.max(0, totalBudget - (Date.now() - totalStart));

  if (signal?.aborted) {
    return buildDeadResult(url, 0, "timeout");
  }

  try {
    const dnsBudget = Math.min(
      DNS_MAX_MS,
      Math.max(DNS_MIN_MS, totalBudget * DNS_BUDGET_FRACTION),
    );
    const hostname = new URL(url).hostname;
    const dnsOk = await resolveDns(hostname, dnsBudget);
    if (!dnsOk) {
      return buildDeadResult(url, Date.now() - totalStart, "dns_failure");
    }

    const detectStart = Date.now();
    let response: Response;

    try {
      response = await fetchFollowingRedirects(url, remainingBudget(), signal);
    } catch (error) {
      return buildDeadResult(
        url,
        Date.now() - totalStart,
        classifyFetchError(error),
      );
    }

    const status = response.status;

    if (status === 402) {
      return buildPaidResult(
        url,
        totalStart,
        detectStart,
        response,
        false,
        router,
      );
    }

    if (status === 404 || status === 405 || status === 410) {
      const postProbe = await tryPostProbe(
        url,
        totalStart,
        detectStart,
        remainingBudget,
        signal,
        router,
      );
      if (postProbe.kind === "paid") return postProbe.result;
      const deathReason: DeathReason = status === 405 ? "http_405" : "http_404";
      return buildDeadResult(url, Date.now() - totalStart, deathReason, status);
    }

    if (status >= 500 && status < 600) {
      return buildDeadResult(url, Date.now() - totalStart, "http_5xx", status);
    }

    if (status >= 200 && status < 300) {
      if (hasValidPaymentHeaders(response)) {
        return buildPaidResult(
          url,
          totalStart,
          detectStart,
          response,
          false,
          router,
        );
      }

      const postProbe = await tryPostProbe(
        url,
        totalStart,
        detectStart,
        remainingBudget,
        signal,
        router,
      );
      if (postProbe.kind === "paid") return postProbe.result;
      if (postProbe.kind === "failed") {
        return buildNonPaidResult(
          url,
          Date.now() - totalStart,
          "ambiguous",
          status,
        );
      }

      return buildNonPaidResult(
        url,
        Date.now() - totalStart,
        "free_confirmed",
        status,
      );
    }

    return buildNonPaidResult(
      url,
      Date.now() - totalStart,
      "ambiguous",
      status,
    );
  } catch {
    // Intent: global budget exhausted or unexpected error — classify as timeout
    return buildDeadResult(url, Date.now() - totalStart, "timeout");
  }
}

function buildDeadResult(
  url: string,
  latencyMs: number,
  deathReason: DeathReason,
  httpStatus?: number,
): DiagnoseResult {
  return {
    url,
    classification: "dead",
    deathReason,
    ...(httpStatus != null ? { httpStatus } : {}),
    isPaid: false,
    protocol: undefined,
    formatVersion: undefined,
    scheme: undefined,
    network: undefined,
    price: undefined,
    facilitator: undefined,
    payTo: undefined,
    health: "dead",
    latencyMs,
    postOnly: false,
  };
}

type PostProbeOutcome =
  | { readonly kind: "paid"; readonly result: DiagnoseResult }
  | { readonly kind: "not_paid" }
  | { readonly kind: "failed" };

async function tryPostProbe(
  url: string,
  totalStart: number,
  detectStart: number,
  remainingBudget: () => number,
  signal: AbortSignal | undefined,
  router: ProtocolRouter,
): Promise<PostProbeOutcome> {
  const postBudget = Math.min(
    remainingBudget(),
    Math.max(POST_MIN_MS, remainingBudget() * POST_BUDGET_FRACTION),
  );
  try {
    const postResponse = await timedFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        redirect: "follow",
      },
      postBudget,
      signal,
    );
    if (postResponse.status === 402) {
      const result = await buildPaidResult(
        url,
        totalStart,
        detectStart,
        postResponse,
        true,
        router,
      );
      return { kind: "paid", result };
    }
    return { kind: "not_paid" };
  } catch {
    // Intent: POST probe network failure — cannot determine paid/free
    return { kind: "failed" };
  }
}

function buildNonPaidResult(
  url: string,
  latencyMs: number,
  classification: "free_confirmed" | "ambiguous",
  httpStatus?: number,
): DiagnoseResult {
  return {
    url,
    classification,
    ...(httpStatus != null ? { httpStatus } : {}),
    isPaid: false,
    protocol: undefined,
    formatVersion: undefined,
    scheme: undefined,
    network: undefined,
    price: undefined,
    facilitator: undefined,
    payTo: undefined,
    health: classification === "free_confirmed" ? "healthy" : "degraded",
    latencyMs,
    postOnly: false,
  };
}

async function buildPaidResult(
  url: string,
  totalStart: number,
  detectStart: number,
  response: Response,
  postOnly: boolean,
  router: ProtocolRouter,
): Promise<DiagnoseResult> {
  let formatVersion: FormatVersion | undefined;
  try {
    const negotiation = await negotiatePayment(response.clone());
    if (negotiation) {
      formatVersion = toFormatVersion(negotiation);
    }
  } catch {
    // Intent: format negotiation is best-effort; diagnosis proceeds without version info
  }

  const detectMs = Date.now() - detectStart;

  const quoteStart = Date.now();
  const probeResults = await router.probeFromResponse(response.clone());
  const quoteMs = Date.now() - quoteStart;

  const primaryProbe = probeResults[0];

  if (!primaryProbe) {
    const mpp = tryDetectMpp(response.clone());
    if (mpp) {
      const latencyMs = Date.now() - totalStart;
      return buildMppDiagnoseResult(url, latencyMs, mpp, postOnly, {
        detectMs,
        quoteMs,
      });
    }
    const latencyMs = Date.now() - totalStart;
    const hasValidFormat = formatVersion !== undefined;
    return {
      url,
      classification: hasValidFormat ? "paid" : "ambiguous",
      isPaid: hasValidFormat,
      protocol: undefined,
      formatVersion,
      scheme: undefined,
      network: undefined,
      price: undefined,
      facilitator: undefined,
      payTo: undefined,
      health: classifyHealth(latencyMs, undefined, undefined),
      latencyMs,
      postOnly,
      timing: { detectMs, quoteMs },
    };
  }

  const { adapter, quote } = primaryProbe;
  const latencyMs = Date.now() - totalStart;

  return {
    url,
    classification: "paid",
    isPaid: true,
    protocol: adapter.name,
    formatVersion,
    scheme: quote.scheme,
    network: quote.network,
    price: quote.amount,
    facilitator: quote.payTo ? truncateAddress(quote.payTo) : undefined,
    payTo: quote.payTo,
    health: classifyHealth(
      latencyMs,
      quote.scheme,
      quote.network,
      quote.amount,
    ),
    latencyMs,
    postOnly,
    chains: buildChains(quote.allAccepts),
    rawAccepts: quote.allAccepts,
    ...(quote.inputHints ? { inputHints: quote.inputHints } : {}),
    ...(quote.allMethods
      ? { mppMethods: quoteMppMethodsToDetails(quote.allMethods) }
      : {}),
    timing: { detectMs, quoteMs },
  };
}

interface MppDetection {
  readonly primary: MppChallenge;
  readonly all: readonly MppChallenge[];
}

function tryDetectMpp(response: Response): MppDetection | undefined {
  const wwwAuth = response.headers.get("www-authenticate");
  if (!wwwAuth) return undefined;
  const { challenges } = parseMppChallenges(wwwAuth);
  const primary = challenges[0];
  if (!primary) return undefined;
  return { primary, all: challenges };
}

function buildMppDiagnoseResult(
  url: string,
  latencyMs: number,
  mpp: MppDetection,
  postOnly: boolean,
  timing: DiagnoseTiming,
): DiagnoseResult {
  const price = tryExtractMppPrice(mpp.primary);
  const network = deriveMppNetwork(mpp.primary);
  const mppRecipient = mpp.primary.request?.recipient;
  const facilitator = mppRecipient ? truncateAddress(mppRecipient) : undefined;
  return {
    url,
    classification: "paid",
    isPaid: true,
    protocol: "mpp",
    formatVersion: "mpp",
    scheme: "exact",
    network,
    price,
    facilitator,
    payTo: mppRecipient,
    health: classifyHealth(latencyMs, "exact", network, price),
    latencyMs,
    postOnly,
    mppMethods: toMppMethodDetails(mpp.all),
    timing,
  };
}

function toMppMethodDetails(
  challenges: readonly MppChallenge[],
): readonly MppMethodDetail[] {
  return challenges.map((c) => ({
    method: c.method,
    intent: c.intent,
    id: c.id,
    expires: c.expires,
    rawAmount: c.request?.amount,
    currency: c.request?.currency,
    recipient: c.request?.recipient,
    chainId: c.request?.chainId,
  }));
}

function quoteMppMethodsToDetails(
  methods: readonly MppMethodQuote[],
): readonly MppMethodDetail[] {
  return methods.map((m) => ({
    method: m.method,
    intent: m.intent,
    id: undefined,
    expires: undefined,
    rawAmount: m.amount.cents.toString(),
    currency: m.currency,
    recipient: m.recipient,
    chainId: m.network ? Number(m.network) || undefined : undefined,
  }));
}

function tryExtractMppPrice(challenge: MppChallenge): Money | undefined {
  if (!challenge.request) return undefined;
  try {
    const rawAmount = BigInt(challenge.request.amount);
    if (rawAmount < 0n) return undefined;
    // Stripe amounts are in smallest currency unit (cents for USD)
    if (challenge.method === "stripe") {
      return Money.fromCents(rawAmount);
    }
    // Crypto methods with chainId: assume 6-decimal stablecoin (USDC/USDT)
    if (challenge.request.chainId !== undefined) {
      return Money.fromCents(usdcAtomicToCents(rawAmount));
    }
    return undefined;
  } catch {
    // Intent: price extraction is best-effort — diagnosis proceeds without price
    return undefined;
  }
}

function deriveMppNetwork(challenge: MppChallenge): string | undefined {
  if (challenge.request?.chainId !== undefined) {
    return `eip155:${challenge.request.chainId}`;
  }
  return undefined;
}
