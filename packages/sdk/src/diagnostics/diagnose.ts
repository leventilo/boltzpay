import { resolve as dnsResolve } from "node:dns/promises";
import type { AcceptOption } from "@boltzpay/core";
import { Money } from "@boltzpay/core";
import type { NegotiatedPayment, ProbeResult } from "@boltzpay/protocols";
import { negotiatePayment, type ProtocolRouter } from "@boltzpay/protocols";

export type EndpointHealth = "healthy" | "degraded" | "dead";

export type EndpointClassification =
  | "paid"
  | "free_confirmed"
  | "dead"
  | "ambiguous";

export type DeathReason =
  | "dns_failure"
  | "http_404"
  | "http_5xx"
  | "timeout"
  | "tls_error";

export type FormatVersion = "V1 body" | "V2 header" | "www-authenticate";

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
  readonly health: EndpointHealth;
  readonly latencyMs: number;
  readonly postOnly: boolean;
  readonly chains?: readonly ChainInfo[];
  readonly rawAccepts?: readonly AcceptOption[];
  readonly timing?: DiagnoseTiming;
}

const TRUNCATE_THRESHOLD = 13;
const TRUNCATE_PREFIX = 6;
const TRUNCATE_SUFFIX = 4;

export function truncateAddress(addr: string): string {
  if (addr.length <= TRUNCATE_THRESHOLD) return addr;
  return `${addr.slice(0, TRUNCATE_PREFIX)}...${addr.slice(-TRUNCATE_SUFFIX)}`;
}

const SLOW_THRESHOLD_MS = 1000;

export function classifyHealth(
  latencyMs: number,
  scheme: string | undefined,
  network: string | undefined,
): EndpointHealth {
  if (scheme && scheme !== "exact") return "degraded";
  if (network?.startsWith("stellar")) return "degraded";
  if (latencyMs >= SLOW_THRESHOLD_MS) return "degraded";
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
}

const DEFAULT_DETECT_TIMEOUT_MS = 10_000;

const DNS_BUDGET_FRACTION = 0.15;
const DNS_MIN_MS = 500;
const DNS_MAX_MS = 3_000;

const POST_BUDGET_FRACTION = 0.4;
const POST_MIN_MS = 500;

const TLS_ERROR_RE = /tls|ssl|certificate/i;

function hasPaymentHeaders(response: Response): boolean {
  if (response.headers.has("x-payment")) return true;
  const wwwAuth = response.headers.get("www-authenticate");
  if (wwwAuth && /X402|L402/i.test(wwwAuth)) return true;
  let hasX402Header = false;
  response.headers.forEach((_value, key) => {
    if (key.toLowerCase().startsWith("x402-")) hasX402Header = true;
  });
  return hasX402Header;
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
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await globalThis.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function diagnoseEndpoint(
  input: DiagnoseInput,
): Promise<DiagnoseResult> {
  const { url, router, detectTimeoutMs } = input;
  const totalBudget = detectTimeoutMs ?? DEFAULT_DETECT_TIMEOUT_MS;
  const totalStart = Date.now();

  const remainingBudget = () =>
    Math.max(0, totalBudget - (Date.now() - totalStart));

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
      response = await timedFetch(
        url,
        { method: "GET", redirect: "follow" },
        remainingBudget(),
      );
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

    if (status === 404 || status === 410) {
      return buildDeadResult(url, Date.now() - totalStart, "http_404", status);
    }

    if (status >= 500 && status < 600) {
      return buildDeadResult(url, Date.now() - totalStart, "http_5xx", status);
    }

    if (status >= 200 && status < 300) {
      if (hasPaymentHeaders(response)) {
        return buildPaidResult(
          url,
          totalStart,
          detectStart,
          response,
          false,
          router,
        );
      }

      const postBudget = Math.max(
        POST_MIN_MS,
        remainingBudget() * POST_BUDGET_FRACTION,
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
        );

        if (postResponse.status === 402) {
          return buildPaidResult(
            url,
            totalStart,
            detectStart,
            postResponse,
            true,
            router,
          );
        }

        return buildNonPaidResult(
          url,
          Date.now() - totalStart,
          "free_confirmed",
        );
      } catch {
        return buildNonPaidResult(url, Date.now() - totalStart, "ambiguous");
      }
    }

    return buildNonPaidResult(url, Date.now() - totalStart, "ambiguous");
  } catch {
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
    health: "dead",
    latencyMs,
    postOnly: false,
  };
}

function buildNonPaidResult(
  url: string,
  latencyMs: number,
  classification: "free_confirmed" | "ambiguous",
): DiagnoseResult {
  return {
    url,
    classification,
    isPaid: false,
    protocol: undefined,
    formatVersion: undefined,
    scheme: undefined,
    network: undefined,
    price: undefined,
    facilitator: undefined,
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
  } catch {}

  const detectMs = Date.now() - detectStart;

  const quoteStart = Date.now();
  let probeResult: ProbeResult | undefined;
  try {
    probeResult = await router.probe(url);
  } catch {
    const latencyMs = Date.now() - totalStart;
    return {
      url,
      classification: "paid",
      isPaid: true,
      protocol: undefined,
      formatVersion,
      scheme: undefined,
      network: undefined,
      price: undefined,
      facilitator: undefined,
      health: classifyHealth(latencyMs, undefined, undefined),
      latencyMs,
      postOnly,
      timing: { detectMs, quoteMs: Date.now() - quoteStart },
    };
  }
  const quoteMs = Date.now() - quoteStart;

  const { adapter, quote } = probeResult;
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
    health: classifyHealth(latencyMs, quote.scheme, quote.network),
    latencyMs,
    postOnly,
    chains: buildChains(quote.allAccepts),
    rawAccepts: quote.allAccepts,
    timing: { detectMs, quoteMs },
  };
}
