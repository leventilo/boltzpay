import type { Money } from "@boltzpay/core";
import { MppQuoteError } from "../adapter-error";

export interface MppResolvedMethod {
  readonly method: string;
  readonly intent: string;
  readonly amount: Money;
  readonly currency: string;
  readonly network: string | undefined;
  readonly recipient: string | undefined;
}

const WALLET_TO_MPP_METHOD: Readonly<Record<string, readonly string[]>> = {
  nwc: ["lightning"],
  "stripe-mpp": ["stripe"],
  tempo: ["tempo"],
  "visa-mpp": ["card"],
} as const;

function buildMethodToWalletMap(): ReadonlyMap<string, readonly string[]> {
  const reverse = new Map<string, string[]>();
  for (const [walletType, methods] of Object.entries(WALLET_TO_MPP_METHOD)) {
    for (const m of methods) {
      const existing = reverse.get(m) ?? [];
      existing.push(walletType);
      reverse.set(m, existing);
    }
  }
  return reverse;
}

const METHOD_TO_WALLET = buildMethodToWalletMap();

function sortByCheapest(
  a: MppResolvedMethod,
  b: MppResolvedMethod,
): number {
  const aZero = a.amount.isZero();
  const bZero = b.amount.isZero();
  if (aZero && !bZero) return 1;
  if (!aZero && bZero) return -1;
  // MPP methods within the same response share a currency — safe to compare
  if (a.amount.currency !== b.amount.currency) return 0;
  if (b.amount.greaterThan(a.amount)) return -1;
  if (a.amount.greaterThan(b.amount)) return 1;
  return 0;
}

export class MppMethodSelector {
  private readonly configuredWalletTypes: ReadonlySet<string>;
  private readonly preferredMethods: readonly string[];

  constructor(
    configuredWalletTypes: ReadonlySet<string>,
    preferredMethods: readonly string[],
  ) {
    this.configuredWalletTypes = configuredWalletTypes;
    this.preferredMethods = preferredMethods;
  }

  select(methods: readonly MppResolvedMethod[]): MppResolvedMethod {
    if (this.preferredMethods.length > 0) {
      return this.selectByPreference(methods);
    }

    if (this.configuredWalletTypes.size > 0) {
      return this.selectByWallet(methods);
    }

    return this.selectCheapest(methods);
  }

  private selectByPreference(
    methods: readonly MppResolvedMethod[],
  ): MppResolvedMethod {
    for (const preferred of this.preferredMethods) {
      const match = methods.find((m) => m.method === preferred);
      if (match) return match;
    }
    return this.selectCheapest(methods);
  }

  private selectByWallet(
    methods: readonly MppResolvedMethod[],
  ): MppResolvedMethod {
    const compatible = methods.filter((m) => this.isWalletCompatible(m.method));
    if (compatible.length === 0) {
      return this.selectCheapest(methods);
    }
    return this.selectCheapest(compatible);
  }

  private isWalletCompatible(methodName: string): boolean {
    const walletTypes = METHOD_TO_WALLET.get(methodName);
    if (!walletTypes) return false;
    return walletTypes.some((wt) => this.configuredWalletTypes.has(wt));
  }

  private selectCheapest(
    methods: readonly MppResolvedMethod[],
  ): MppResolvedMethod {
    const sorted = [...methods].sort(sortByCheapest);
    const best = sorted[0];
    if (!best) {
      throw new MppQuoteError("No MPP methods available for selection");
    }
    return best;
  }
}
