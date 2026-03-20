interface MppRequest {
  readonly amount: string;
  readonly currency: string;
  readonly recipient: string;
  readonly chainId: number | undefined;
  readonly methodDetails: Readonly<Record<string, unknown>> | undefined;
}

interface MppChallenge {
  readonly id: string | undefined;
  readonly method: string;
  readonly intent: string;
  readonly realm: string | undefined;
  readonly expires: string | undefined;
  readonly request: MppRequest | undefined;
}

interface MppParseResult {
  readonly challenges: readonly MppChallenge[];
}

export type { MppChallenge, MppParseResult, MppRequest };
