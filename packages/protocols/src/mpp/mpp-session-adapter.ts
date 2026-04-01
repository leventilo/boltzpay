import type {
  ManagedSession,
  SessionAdapter,
  SessionCloseResult,
  SessionOptions,
} from "@boltzpay/core";
import { MppPaymentError } from "../adapter-error";
import { validateHexPrivateKey } from "./mpp-method-factory";

const SSE_CONTENT_TYPE = "text/event-stream";

const DEFAULT_DECIMALS = 6;
const CLOSE_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 30_000;

function bigintToDecimalString(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  if (remainder === 0n) {
    return whole.toString();
  }
  const fracStr = remainder
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export interface ChannelUpdateEntry {
  readonly channelId: string;
  readonly salt: string;
  readonly cumulativeAmount: bigint;
  readonly escrowContract: string;
  readonly chainId: number;
  readonly opened: boolean;
}

export type MppStreamEvent =
  | { readonly type: "data"; readonly payload: string }
  | {
      readonly type: "payment";
      readonly channelId: string;
      readonly cumulativeAmount: bigint;
      readonly index: number;
    };

interface MppxLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  createCredential(
    response: Response,
    context?: Record<string, unknown>,
  ): Promise<string>;
}

class MppManagedSession implements ManagedSession {
  private mppx: MppxLike;
  private readonly url: string;
  private channelEntry: ChannelUpdateEntry | undefined;

  constructor(mppx: MppxLike, url: string) {
    this.mppx = mppx;
    this.url = url;
  }

  get channelId(): string {
    return this.channelEntry?.channelId ?? "unknown";
  }

  get spent(): bigint {
    return this.channelEntry?.cumulativeAmount ?? 0n;
  }

  updateChannel(entry: ChannelUpdateEntry): void {
    this.channelEntry = entry;
  }

  bindMppx(mppx: MppxLike): void {
    this.mppx = mppx;
  }

  async fetch(url: string, init?: Record<string, unknown>): Promise<Response> {
    // Adapter boundary: ManagedSession uses generic Record, mppx expects RequestInit
    return this.mppx.fetch(url, init as RequestInit);
  }

  async close(): Promise<SessionCloseResult> {
    const totalSpent = this.channelEntry?.cumulativeAmount ?? 0n;
    const channelId = this.channelEntry?.channelId ?? "unknown";

    if (this.channelEntry?.opened) {
      try {
        const probeResponse = await this.mppx.fetch(this.url, {
          method: "GET",
          signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS),
        });
        await this.mppx.createCredential(probeResponse, {
          action: "close",
          channelId,
          cumulativeAmountRaw: totalSpent.toString(),
        });
      } catch {
        // Intent: close credential failure is non-fatal — channel can be closed on-chain later
      }
    }

    return { channelId, totalSpent, refunded: 0n };
  }

  async *stream(
    url: string,
    init?: Record<string, unknown>,
  ): AsyncIterable<MppStreamEvent> {
    // Adapter boundary: ManagedSession uses generic Record, mppx expects RequestInit
    const response = await this.mppx.fetch(url, init as RequestInit);
    const contentType = extractContentType(response);
    const isSSE = contentType.includes(SSE_CONTENT_TYPE);

    if (!isSSE) {
      const text = await readResponseText(response);
      yield { type: "data", payload: text };
      return;
    }

    const body = response.body;
    if (!body) {
      return;
    }

    const snapshotBefore = this.channelEntry;
    yield* this.parseSSEStream(body, snapshotBefore);
  }

  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
    snapshotBefore: ChannelUpdateEntry | undefined,
  ): AsyncIterable<MppStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let voucherIndex = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const events = extractSSEEvents(buffer);
        buffer = events.remainder;

        for (const raw of events.parsed) {
          yield { type: "data", payload: raw };
        }

        const channelChanged =
          this.channelEntry !== undefined &&
          this.channelEntry !== snapshotBefore &&
          this.channelEntry.cumulativeAmount !==
            (snapshotBefore?.cumulativeAmount ?? 0n);

        if (channelChanged && this.channelEntry) {
          voucherIndex++;
          const entry = this.channelEntry;
          snapshotBefore = entry;
          yield {
            type: "payment",
            channelId: entry.channelId,
            cumulativeAmount: entry.cumulativeAmount,
            index: voucherIndex,
          };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function extractContentType(response: Response): string {
  if (typeof response.headers?.get === "function") {
    return response.headers.get("content-type") ?? "";
  }
  return "";
}

async function readResponseText(response: Response): Promise<string> {
  if (typeof response.text === "function") {
    return response.text();
  }
  return "";
}

interface SSEParseResult {
  readonly parsed: readonly string[];
  readonly remainder: string;
}

function extractSSEEvents(buffer: string): SSEParseResult {
  const parsed: string[] = [];
  const blocks = buffer.split("\n\n");
  const remainder = blocks.pop() ?? "";

  for (const block of blocks) {
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) {
        dataLines.push(line.slice(6));
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5));
      }
    }
    if (dataLines.length > 0) {
      parsed.push(dataLines.join("\n"));
    }
  }

  return { parsed, remainder };
}

export class MppSessionManager implements SessionAdapter {
  readonly name = "mpp-session";
  private readonly walletConfig: { readonly tempoPrivateKey: string };
  private readonly onUpdate: ((entry: ChannelUpdateEntry) => void) | undefined;

  constructor(
    walletConfig: { readonly tempoPrivateKey: string },
    onUpdate?: (entry: ChannelUpdateEntry) => void,
  ) {
    this.walletConfig = walletConfig;
    this.onUpdate = onUpdate;
  }

  async openSession(
    url: string,
    options: SessionOptions,
  ): Promise<ManagedSession> {
    try {
      const { privateKeyToAccount } = await import("viem/accounts");
      const validatedKey = validateHexPrivateKey(
        this.walletConfig.tempoPrivateKey,
      );
      const account = privateKeyToAccount(validatedKey);

      const maxDepositHuman = options.maxDeposit
        ? bigintToDecimalString(options.maxDeposit, DEFAULT_DECIMALS)
        : undefined;

      // Create managed session first so onChannelUpdate can wire into it
      const placeholder: MppxLike = {
        fetch: () => Promise.resolve(new Response()),
        createCredential: () => Promise.resolve(""),
      };
      const managedSession = new MppManagedSession(placeholder, url);

      const onChannelUpdate = (entry: ChannelUpdateEntry) => {
        managedSession.updateChannel(entry);
        this.onUpdate?.(entry);
      };

      const { session, Mppx } = await import("mppx/client");
      const sessionMethod = session({
        account,
        maxDeposit: maxDepositHuman,
        onChannelUpdate,
      });

      const mppx = Mppx.create({
        fetch: globalThis.fetch,
        methods: [sessionMethod],
        polyfill: false,
      });

      managedSession.bindMppx(mppx as unknown as MppxLike);

      // Initial fetch triggers 402 challenge and session open
      await mppx.fetch(url, {
        method: "GET",
        signal: options.signal ?? AbortSignal.timeout(OPEN_TIMEOUT_MS),
      });

      return managedSession;
    } catch (err) {
      if (err instanceof MppPaymentError) throw err;
      const msg = err instanceof Error ? err.message : "Session open failed";
      throw new MppPaymentError(`MPP session open failed: ${msg}`, {
        cause: err,
      });
    }
  }
}

export interface StreamableSession extends ManagedSession {
  stream(
    url: string,
    init?: Record<string, unknown>,
  ): AsyncIterable<MppStreamEvent>;
}

export function isStreamableSession(
  session: ManagedSession,
): session is StreamableSession {
  return (
    typeof (session as unknown as Record<string, unknown>)["stream"] ===
    "function"
  );
}
