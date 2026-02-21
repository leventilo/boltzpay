import type { Money } from "@boltzpay/core";
import type { BudgetState } from "./budget/budget-manager";

/** Whether a provider credential (Coinbase, NWC/Lightning) is configured. */
export interface CredentialStatus {
  readonly configured: boolean;
  readonly keyHint: string | undefined;
}

/** Result of probing wallet connectivity — connected, error, or skipped. */
export type ConnectionStatus =
  | { readonly status: "connected"; readonly latencyMs: number }
  | {
      readonly status: "error";
      readonly error: string;
      readonly latencyMs?: number;
    }
  | { readonly status: "skipped"; readonly reason: string };

/** On-chain account address and optional USDC balance. */
export interface AccountStatus {
  readonly address: string;
  readonly balance: Money | undefined;
}

/** Lightning wallet connectivity and balance snapshot. */
export interface LightningStatus {
  readonly configured: boolean;
  readonly connection: {
    readonly status: "connected" | "error" | "skipped";
    readonly latencyMs?: number;
    readonly error?: string;
  };
  readonly balance?: { readonly sats: bigint; readonly display: string };
}

/** Comprehensive wallet health snapshot returned by `BoltzPay.getWalletStatus()`. */
export interface WalletStatus {
  readonly network: string;
  readonly isTestnet: boolean;
  readonly protocols: readonly string[];
  readonly canPay: boolean;
  readonly credentials: {
    readonly coinbase: CredentialStatus;
  };
  readonly connection: ConnectionStatus;
  readonly accounts: {
    readonly evm: AccountStatus | undefined;
    readonly svm: AccountStatus | undefined;
  };
  readonly budget: BudgetState;
  readonly lightning?: LightningStatus;
}
