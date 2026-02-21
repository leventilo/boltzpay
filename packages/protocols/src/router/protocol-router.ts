import {
  type Money,
  type ProtocolAdapter,
  ProtocolDetectionFailedError,
  type ProtocolQuote,
  type ProtocolResult,
} from "@boltzpay/core";

/**
 * Adapter that can extract a quote from an existing 402 response
 * without making a new HTTP request. Used for late detection when
 * the initial GET probe did not trigger a 402 but the real request did.
 */
export interface ResponseAwareAdapter extends ProtocolAdapter {
  quoteFromResponse(response: Response): Promise<ProtocolQuote | null>;
}

function isResponseAware(
  adapter: ProtocolAdapter,
): adapter is ResponseAwareAdapter {
  return (
    typeof (adapter as ResponseAwareAdapter).quoteFromResponse === "function"
  );
}

/**
 * Result of probing a single adapter: the adapter itself and its quote.
 * Returned by probeAll() to enable SDK-layer fallback execution.
 */
export interface ProbeResult {
  readonly adapter: ProtocolAdapter;
  readonly quote: ProtocolQuote;
}

function throwFirstRejectionIfAllFailed(
  results: readonly PromiseSettledResult<unknown>[],
): void {
  if (!results.every((r) => r.status === "rejected")) return;

  const firstRejection = results.find((r) => r.status === "rejected");
  if (firstRejection && firstRejection.status === "rejected") {
    throw firstRejection.reason instanceof Error
      ? firstRejection.reason
      : new Error(String(firstRejection.reason));
  }
}

export class ProtocolRouter {
  constructor(private readonly adapters: readonly ProtocolAdapter[]) {}

  /**
   * Probe all adapters and return the first match (backward compat).
   * For multi-adapter fallback, use probeAll() instead.
   */
  async probe(
    url: string,
    headers?: Record<string, string>,
  ): Promise<{ adapter: ProtocolAdapter; quote: ProtocolQuote }> {
    const results = await Promise.allSettled(
      this.adapters.map((a) => a.detect(url, headers)),
    );

    const matchIndex = results.findIndex(
      (r) => r.status === "fulfilled" && r.value === true,
    );

    if (matchIndex === -1) {
      throwFirstRejectionIfAllFailed(results);
      throw new ProtocolDetectionFailedError(url);
    }

    const adapter = this.adapters[matchIndex];
    if (!adapter) {
      throw new ProtocolDetectionFailedError(url);
    }
    const quote = await adapter.quote(url, headers);
    return { adapter, quote };
  }

  /**
   * Probe all adapters in parallel and return ALL matching adapters with quotes.
   * Enables SDK-layer fallback: try primary adapter, fall back to secondary on failure.
   *
   * Detection runs in parallel for all adapters. Adapters that detect successfully
   * are then quoted in parallel. Only adapters with successful quotes are returned.
   *
   * @throws ProtocolDetectionFailedError if no adapter detects a supported protocol
   * @throws ProtocolDetectionFailedError if all detected adapters fail to produce quotes
   */
  async probeAll(
    url: string,
    headers?: Record<string, string>,
  ): Promise<readonly ProbeResult[]> {
    const detectionResults = await Promise.allSettled(
      this.adapters.map((a) => a.detect(url, headers)),
    );

    const detected: ProtocolAdapter[] = [];
    for (let i = 0; i < detectionResults.length; i++) {
      const result = detectionResults[i];
      const adapter = this.adapters[i];
      if (
        result &&
        result.status === "fulfilled" &&
        result.value === true &&
        adapter
      ) {
        detected.push(adapter);
      }
    }

    if (detected.length === 0) {
      throwFirstRejectionIfAllFailed(detectionResults);
      throw new ProtocolDetectionFailedError(url);
    }

    const quoteResults = await Promise.allSettled(
      detected.map(async (adapter) => {
        const quote = await adapter.quote(url, headers);
        return { adapter, quote } satisfies ProbeResult;
      }),
    );

    const results: ProbeResult[] = [];
    for (const qr of quoteResults) {
      if (qr.status === "fulfilled") {
        results.push(qr.value);
      }
    }

    if (results.length === 0) {
      throw new ProtocolDetectionFailedError(url);
    }

    return results;
  }

  async execute(
    adapter: ProtocolAdapter,
    request: {
      readonly url: string;
      readonly method: string;
      readonly headers: Record<string, string>;
      readonly body: Uint8Array | undefined;
      readonly amount: Money;
    },
  ): Promise<ProtocolResult> {
    return adapter.execute(request);
  }

  /**
   * Detect protocol from an existing 402 response (late detection).
   * Used when the GET probe found nothing but the real request returned 402.
   * Clones the response for each adapter to preserve the body stream.
   */
  async probeFromResponse(response: Response): Promise<readonly ProbeResult[]> {
    if (response.status !== 402) return [];
    const results: ProbeResult[] = [];
    for (const adapter of this.adapters) {
      if (!isResponseAware(adapter)) continue;
      try {
        const quote = await adapter.quoteFromResponse(response.clone());
        if (quote) results.push({ adapter, quote });
      } catch {}
    }
    return results;
  }

  getAdapterByName(name: string): ProtocolAdapter | undefined {
    return this.adapters.find((a) => a.name === name);
  }
}
