import { L402PaymentError } from "../adapter-error";

interface NwcClientLike {
  payInvoice(params: { invoice: string }): Promise<{ preimage: string }>;
  getBalance(): Promise<{ balance: number }>;
  close(): void;
}

const NWC_PAY_TIMEOUT_MS = 60_000;
const NWC_BALANCE_TIMEOUT_MS = 15_000;
const NWC_CONNECT_TIMEOUT_MS = 15_000;

function withNwcTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new L402PaymentError(
          `NWC ${operation} timed out after ${ms / 1000}s. Check your NWC relay and wallet connectivity.`,
        ),
      );
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Manages a Nostr Wallet Connect (NWC) Lightning wallet.
 * Lazy-loads `@getalby/sdk` on first use to avoid bundling it when unused.
 */
export class NwcWalletManager {
  private client: NwcClientLike | undefined;

  constructor(private readonly connectionString: string) {}

  async payInvoice(bolt11: string): Promise<{ preimage: string }> {
    try {
      const client = await this.getClient();
      const response = await withNwcTimeout(
        client.payInvoice({ invoice: bolt11 }),
        NWC_PAY_TIMEOUT_MS,
        "payment",
      );
      if (!response.preimage) {
        throw new Error("NWC returned empty preimage");
      }
      return { preimage: response.preimage };
    } catch (err) {
      if (err instanceof L402PaymentError) throw err;
      const msg = err instanceof Error ? err.message : "Unknown NWC error";
      throw new L402PaymentError(`NWC payment failed: ${msg}`);
    }
  }

  /** Close the underlying NWC WebSocket connection. Safe to call multiple times. */
  close(): void {
    if (this.client) {
      this.client.close();
      this.client = undefined;
    }
  }

  async getBalance(): Promise<{ balanceSats: bigint }> {
    try {
      const client = await this.getClient();
      const { balance } = await withNwcTimeout(
        client.getBalance(),
        NWC_BALANCE_TIMEOUT_MS,
        "balance check",
      );
      return { balanceSats: BigInt(balance) };
    } catch (err) {
      if (err instanceof L402PaymentError) throw err;
      const msg = err instanceof Error ? err.message : "Unknown NWC error";
      throw new L402PaymentError(`NWC balance check failed: ${msg}`);
    }
  }

  private async getClient(): Promise<NwcClientLike> {
    if (this.client) return this.client;
    const mod: unknown = await withNwcTimeout(
      import("@getalby/sdk/nwc"),
      NWC_CONNECT_TIMEOUT_MS,
      "connection",
    );
    if (
      !mod ||
      typeof mod !== "object" ||
      !("NWCClient" in mod) ||
      typeof (mod as Record<string, unknown>).NWCClient !== "function"
    ) {
      throw new L402PaymentError(
        "@getalby/sdk/nwc module does not export NWCClient",
      );
    }
    const { NWCClient } = mod as {
      NWCClient: new (opts: { nostrWalletConnectUrl: string }) => NwcClientLike;
    };
    this.client = new NWCClient({
      nostrWalletConnectUrl: this.connectionString,
    });
    return this.client;
  }
}
