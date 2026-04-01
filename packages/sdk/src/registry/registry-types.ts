export interface RegistryEndpoint {
  readonly slug: string;
  readonly name: string;
  readonly url: string;
  readonly protocol: string | undefined;
  readonly score: number;
  readonly health: string;
  readonly category: string;
  readonly isPaid: boolean;
  readonly badge: "new" | "established" | null;
}

export interface RegistryListResponse {
  readonly data: readonly RegistryEndpoint[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface RegistryFetchOptions {
  readonly protocol?: string;
  readonly minScore?: number;
  readonly category?: string;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly signal?: AbortSignal;
}

export type DiscoveredEntry = RegistryEndpoint;

export interface DiscoverOptions {
  readonly protocol?: string;
  readonly minScore?: number;
  readonly category?: string;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly signal?: AbortSignal;
}
