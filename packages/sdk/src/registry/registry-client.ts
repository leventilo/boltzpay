import { NetworkError } from "../errors/network-error";
import type { RegistryFetchOptions, RegistryListResponse } from "./registry-types";

const REGISTRY_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_REGISTRY_LIMIT = 200;

export const DEFAULT_REGISTRY_URL = "https://status.boltzpay.ai";

export async function fetchRegistryEndpoints(
  registryUrl: string,
  options?: RegistryFetchOptions,
): Promise<RegistryListResponse> {
  const url = new URL("/api/endpoints", registryUrl);

  if (options?.protocol) {
    url.searchParams.set("protocol", options.protocol);
  }
  if (options?.minScore !== undefined) {
    url.searchParams.set("min_score", String(options.minScore));
  }
  if (options?.category) {
    url.searchParams.set("category", options.category);
  }
  if (options?.query) {
    url.searchParams.set("q", options.query);
  }
  url.searchParams.set(
    "limit",
    String(options?.limit ?? DEFAULT_REGISTRY_LIMIT),
  );
  if (options?.offset !== undefined) {
    url.searchParams.set("offset", String(options.offset));
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal:
        options?.signal ?? AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    throw new NetworkError(
      "registry_unavailable",
      `Registry API fetch failed: ${message}`,
    );
  }

  if (!response.ok) {
    throw new NetworkError(
      "registry_unavailable",
      `Registry API returned ${response.status}: ${response.statusText}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new NetworkError(
      "registry_invalid_response",
      "Registry API returned invalid JSON",
    );
  }

  return parseRegistryResponse(body);
}

function parseRegistryResponse(body: unknown): RegistryListResponse {
  if (typeof body !== "object" || body === null) {
    throw new NetworkError(
      "registry_invalid_response",
      "Registry API response is not an object",
    );
  }

  const obj = body as Record<string, unknown>;

  if (!Array.isArray(obj.data)) {
    throw new NetworkError(
      "registry_invalid_response",
      "Registry API response missing 'data' array",
    );
  }

  for (const entry of obj.data) {
    if (!isValidEndpoint(entry)) {
      throw new NetworkError(
        "registry_invalid_response",
        "Registry API response contains invalid endpoint entry",
      );
    }
  }

  return {
    data: obj.data as RegistryListResponse["data"],
    total: typeof obj.total === "number" ? obj.total : obj.data.length,
    offset: typeof obj.offset === "number" ? obj.offset : 0,
    limit: typeof obj.limit === "number" ? obj.limit : obj.data.length,
    hasMore: typeof obj.hasMore === "boolean" ? obj.hasMore : false,
  };
}

const VALID_BADGES = new Set<unknown>(["new", "established", null]);

function isValidEndpoint(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.slug === "string" &&
    typeof e.name === "string" &&
    typeof e.url === "string" &&
    typeof e.score === "number" &&
    typeof e.health === "string" &&
    typeof e.category === "string" &&
    typeof e.isPaid === "boolean" &&
    (e.protocol === undefined || typeof e.protocol === "string") &&
    VALID_BADGES.has(e.badge)
  );
}
