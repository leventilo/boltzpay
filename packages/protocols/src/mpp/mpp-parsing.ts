import type { MppChallenge, MppParseResult, MppRequest } from "./mpp-types";

const MPP_SCHEME_RE = /(?:^|,\s*)Payment\s+\w+\s*=/i;
const PARAM_RE = /(\w+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g;

function hasMppScheme(wwwAuthenticate: string): boolean {
  return MPP_SCHEME_RE.test(wwwAuthenticate);
}

function parseMppChallenges(wwwAuthenticate: string): MppParseResult {
  if (!hasMppScheme(wwwAuthenticate)) {
    return { challenges: [] };
  }
  const sections = splitChallenges(wwwAuthenticate);
  const challenges: MppChallenge[] = [];
  for (const section of sections) {
    const challenge = parseSingleChallenge(section);
    if (challenge) challenges.push(challenge);
  }
  return { challenges };
}

function splitChallenges(header: string): string[] {
  const starts: number[] = [];
  let i = 0;
  while (i < header.length) {
    if (header[i] === '"') {
      i++;
      while (i < header.length && header[i] !== '"') i++;
      i++;
      continue;
    }
    const remaining = header.slice(i);
    const m = remaining.match(/^Payment\s/i);
    if (m && (i === 0 || /[\s,]/.test(header[i - 1]!))) {
      starts.push(i + m[0].length);
    }
    i++;
  }
  const results: string[] = [];
  for (let j = 0; j < starts.length; j++) {
    const start = starts[j];
    if (start === undefined) continue;
    const end = starts[j + 1];
    const raw =
      end !== undefined ? header.slice(start, end) : header.slice(start);
    results.push(
      raw
        .replace(/,\s*Payment\s*$/i, "")
        .replace(/,\s*$/, "")
        .trim(),
    );
  }
  return results;
}

function parseMppParams(content: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const match of content.matchAll(PARAM_RE)) {
    const key = match[1];
    const value = match[2] ?? match[3];
    if (key !== undefined && value !== undefined) {
      params[key.toLowerCase()] = value;
    }
  }
  return params;
}

function parseSingleChallenge(content: string): MppChallenge | undefined {
  const params = parseMppParams(content);
  const method = params.method;
  if (!method) return undefined;
  return {
    id: params.id,
    method,
    intent: params.intent ?? "charge",
    realm: params.realm,
    expires: params.expires,
    request: params.request ? decodeMppRequest(params.request) : undefined,
  };
}

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  return atob(base64 + "=".repeat(padLength));
}

function decodeMppRequest(encoded: string): MppRequest | undefined {
  try {
    const json = decodeBase64Url(encoded);
    const parsed: unknown = JSON.parse(json);
    return validateMppRequest(parsed);
  } catch {
    // Intent: malformed request payload should not crash diagnosis
    return undefined;
  }
}

function validateMppRequest(data: unknown): MppRequest | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  // External protocol data — narrowing after runtime typeof+null check
  const obj = data as Record<string, unknown>;
  const amount = typeof obj.amount === "string" ? obj.amount : undefined;
  const currency = typeof obj.currency === "string" ? obj.currency : undefined;
  const recipient =
    typeof obj.recipient === "string" ? obj.recipient : undefined;
  if (!amount || !currency || !recipient) return undefined;
  const details = extractMethodDetails(obj.methodDetails);
  return {
    amount,
    currency,
    recipient,
    chainId: details?.chainId,
    methodDetails: details?.raw,
  };
}

function extractMethodDetails(
  raw: unknown,
): { chainId: number | undefined; raw: Record<string, unknown> } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  // External protocol data — narrowing after runtime typeof+null check
  const obj = raw as Record<string, unknown>;
  const chainId = typeof obj.chainId === "number" ? obj.chainId : undefined;
  return { chainId, raw: obj };
}

export {
  decodeBase64Url,
  decodeMppRequest,
  hasMppScheme,
  parseMppChallenges,
  parseMppParams,
  parseSingleChallenge,
  splitChallenges,
};
