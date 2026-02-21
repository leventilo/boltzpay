/** Standard L402 challenge: macaroon + invoice (Lightning Faucet, Satring, etc.) */
export interface L402StandardChallenge {
  readonly kind: "standard";
  readonly macaroon: string;
  readonly invoice: string;
  readonly prefix: "L402" | "LSAT";
}

/** Invoice-only L402 challenge: invoice + payment_hash, no macaroon (MaxSats, etc.) */
export interface L402InvoiceOnlyChallenge {
  readonly kind: "invoice-only";
  readonly invoice: string;
  readonly paymentHash: string;
  readonly prefix: "L402" | "LSAT";
}

/** Discriminated union of all supported L402 challenge formats. */
export type L402ParsedChallenge =
  | L402StandardChallenge
  | L402InvoiceOnlyChallenge;

/** @deprecated Use L402ParsedChallenge instead. Kept for backward compat. */
export type L402Challenge = L402StandardChallenge;

const L402_STANDARD_REGEX =
  /(?:L402|LSAT)\s+macaroon="([^"]+)"\s*,\s*invoice="([^"]+)"/i;

const L402_INVOICE_ONLY_REGEX =
  /(?:L402|LSAT)\s+invoice="([^"]+)"\s*,\s*payment_hash="([^"]+)"/i;

const MILLISATS_PER_SAT = 1000n;

const BASE64_PATTERN = /^[A-Za-z0-9+/\-_]*={0,2}$/;
const PAYMENT_HASH_PATTERN = /^[0-9a-f]{64}$/i;

function extractPrefix(matched: string): "L402" | "LSAT" {
  return matched.toUpperCase().startsWith("LSAT") ? "LSAT" : "L402";
}

/**
 * Parse an L402 challenge from a WWW-Authenticate header value.
 *
 * Supports two formats:
 * - Standard: `L402 macaroon="<base64>", invoice="<bolt11>"` (also LSAT prefix)
 * - Invoice-only: `L402 invoice="<bolt11>", payment_hash="<hex>"` (MaxSats style)
 */
export function parseL402Challenge(header: string): L402ParsedChallenge {
  const stdMatch = L402_STANDARD_REGEX.exec(header);
  if (stdMatch?.[0] && stdMatch[1] && stdMatch[2]) {
    const macaroon = stdMatch[1];
    if (!BASE64_PATTERN.test(macaroon)) {
      throw new Error(
        "Invalid L402 macaroon: must be valid base64 (alphanumeric, +, /, = padding)",
      );
    }
    return {
      kind: "standard",
      macaroon,
      invoice: stdMatch[2],
      prefix: extractPrefix(stdMatch[0]),
    } as const;
  }

  const invMatch = L402_INVOICE_ONLY_REGEX.exec(header);
  if (invMatch?.[0] && invMatch[1] && invMatch[2]) {
    const paymentHash = invMatch[2];
    if (!PAYMENT_HASH_PATTERN.test(paymentHash)) {
      throw new Error("Invalid L402 payment_hash: must be 64 hex characters");
    }
    return {
      kind: "invoice-only",
      invoice: invMatch[1],
      paymentHash,
      prefix: extractPrefix(invMatch[0]),
    } as const;
  }

  throw new Error(
    `Invalid L402 WWW-Authenticate header: expected 'L402 macaroon="...", invoice="..."' or 'L402 invoice="...", payment_hash="..."' (also accepts LSAT prefix)`,
  );
}

/**
 * Detect whether a WWW-Authenticate header contains an L402 challenge.
 * Matches both standard (macaroon+invoice) and invoice-only (invoice+payment_hash) formats.
 */
export function isL402Challenge(header: string): boolean {
  return (
    L402_STANDARD_REGEX.test(header) || L402_INVOICE_ONLY_REGEX.test(header)
  );
}

interface Bolt11Section {
  readonly name: string;
  readonly value: unknown;
}

interface Bolt11DecodeResult {
  readonly sections: readonly Bolt11Section[];
}

/**
 * Decode a BOLT11 invoice and extract the amount in satoshis.
 * Returns the amount as bigint sats.
 *
 * @throws Error if the invoice has no amount or the amount is invalid.
 */
export function decodeBolt11Amount(_invoice: string): bigint {
  throw new Error(
    "decodeBolt11Amount requires a decoder — use decodeBolt11AmountWith(decode, invoice) instead",
  );
}

/**
 * Decode a BOLT11 invoice amount using the provided decoder function.
 * The decoder is `decode` from `light-bolt11-decoder`.
 *
 * Amount is returned in millisatoshis internally, converted to satoshis (rounded up).
 * Amount-less BOLT11 invoices are rejected: HTTP 402 requires a fixed positive amount.
 */
export function decodeBolt11AmountWith(
  decode: (invoice: string) => Bolt11DecodeResult,
  invoice: string,
): bigint {
  const result = decode(invoice);
  const amountSection = result.sections.find((s) => s.name === "amount");
  if (!amountSection || amountSection.value === undefined) {
    throw new Error("BOLT11 invoice has no amount field");
  }
  if (typeof amountSection.value !== "string") {
    throw new Error(
      `BOLT11 amount must be a string, got ${typeof amountSection.value}`,
    );
  }
  const msats = BigInt(amountSection.value);
  if (msats <= 0n) {
    throw new Error("BOLT11 invoice amount must be positive");
  }
  return (msats + MILLISATS_PER_SAT - 1n) / MILLISATS_PER_SAT;
}
