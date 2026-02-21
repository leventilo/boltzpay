import type { TransactionSigner } from "@solana/kit";
import { Mutex } from "async-mutex";
import { CdpProvisioningError } from "../adapter-error";
import { usdcAtomicToCents } from "../x402/usdc-conversion";
import type { CdpAccount, CdpClientLike } from "./cdp-manager";
import { type CdpSolanaAccount, CdpSvmSigner } from "./cdp-svm-signer";

/** USDC ERC-20 contract addresses per EVM network. */
const EVM_USDC: Record<string, `0x${string}`> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

/** USDC SPL mint addresses per Solana network. */
const SVM_USDC: Record<string, string> = {
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "solana-devnet": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

/** Map SDK network names ("base"/"base-sepolia") to Solana CDP network names. */
const SOLANA_NETWORK: Record<string, string> = {
  base: "solana",
  "base-sepolia": "solana-devnet",
};

/**
 * CDP client with Solana support and balance queries in addition to EVM.
 */
export interface CdpMultiChainClient extends CdpClientLike {
  evm: CdpClientLike["evm"] & {
    listTokenBalances(opts: {
      address: `0x${string}`;
      network: string;
    }): Promise<{
      balances: Array<{
        token: { contractAddress: `0x${string}` };
        amount: { amount: bigint; decimals: number };
      }>;
    }>;
  };
  solana: {
    createAccount(): Promise<CdpSolanaAccount>;
    listTokenBalances(opts: { address: string; network?: string }): Promise<{
      balances: Array<{
        token: { mintAddress: string };
        amount: { amount: bigint; decimals: number };
      }>;
    }>;
  };
}

/**
 * Balance information per chain. Values are undefined when balance queries
 * are unavailable (graceful degradation).
 */
export interface WalletBalances {
  readonly evm?: {
    readonly address: string;
    readonly balanceUsdcCents: bigint | undefined;
  };
  readonly svm?: {
    readonly address: string;
    readonly balanceUsdcCents: bigint | undefined;
  };
}

/**
 * Manages dual EVM + Solana accounts via CDP SDK.
 *
 * Each chain has independent mutex + cache: provisioning one chain never blocks the other.
 * EVM uses getOrCreateAccount (deterministic by name). Solana uses createAccount (new each time,
 * cached after first call).
 */
export class CdpWalletManager {
  private readonly evmMutex = new Mutex();
  private readonly svmMutex = new Mutex();
  private cachedEvmAccount: CdpAccount | undefined;
  private cachedSolanaAccount: CdpSolanaAccount | undefined;

  constructor(
    private readonly createClient: () =>
      | CdpMultiChainClient
      | Promise<CdpMultiChainClient>,
    private readonly accountName: string,
  ) {}

  /**
   * Provision or return cached EVM account.
   * Same logic as CdpManager.getOrProvisionAccount() for backward compat.
   */
  async getOrProvisionEvmAccount(): Promise<CdpAccount> {
    return this.evmMutex.runExclusive(async () => {
      if (this.cachedEvmAccount) {
        return this.cachedEvmAccount;
      }

      const client = await this.resolveClient();

      try {
        const account = await client.evm.getOrCreateAccount({
          name: this.accountName,
        });
        this.cachedEvmAccount = account;
        return account;
      } catch (err) {
        if (err instanceof CdpProvisioningError) throw err;
        const msg =
          err instanceof Error ? err.message : "Unknown CDP EVM error";
        throw new CdpProvisioningError(msg);
      }
    });
  }

  /**
   * Provision or return cached Solana account.
   * Creates a new Solana account on first call, caches it for subsequent calls.
   */
  async getOrProvisionSolanaAccount(): Promise<CdpSolanaAccount> {
    return this.svmMutex.runExclusive(async () => {
      if (this.cachedSolanaAccount) {
        return this.cachedSolanaAccount;
      }

      const client = await this.resolveClient();

      try {
        const account = await client.solana.createAccount();
        this.cachedSolanaAccount = account;
        return account;
      } catch (err) {
        if (err instanceof CdpProvisioningError) throw err;
        const msg =
          err instanceof Error ? err.message : "Unknown CDP Solana error";
        throw new CdpProvisioningError(msg);
      }
    });
  }

  /**
   * Get a TransactionSigner for Solana, suitable for use with @x402/svm.
   * Provisions Solana account if not yet created.
   */
  async getSvmSigner(): Promise<TransactionSigner> {
    const account = await this.getOrProvisionSolanaAccount();
    return new CdpSvmSigner(account);
  }

  /**
   * Query USDC balances per chain via CDP SDK listTokenBalances API.
   * Returns undefined for balance when the query fails (graceful degradation).
   * Returns 0n when the account exists but holds no USDC.
   *
   * @param network SDK network name ("base" or "base-sepolia").
   */
  async getBalances(network: string): Promise<WalletBalances> {
    const [evmBalance, svmBalance] = await Promise.all([
      this.cachedEvmAccount
        ? this.queryEvmUsdcBalance(this.cachedEvmAccount.address, network)
        : undefined,
      this.cachedSolanaAccount
        ? this.querySolanaUsdcBalance(this.cachedSolanaAccount.address, network)
        : undefined,
    ]);

    return {
      ...(this.cachedEvmAccount
        ? {
            evm: {
              address: this.cachedEvmAccount.address,
              balanceUsdcCents: evmBalance,
            },
          }
        : {}),
      ...(this.cachedSolanaAccount
        ? {
            svm: {
              address: this.cachedSolanaAccount.address,
              balanceUsdcCents: svmBalance,
            },
          }
        : {}),
    };
  }

  async testConnectivity(): Promise<
    | { readonly ok: true; readonly latencyMs: number }
    | { readonly ok: false; readonly error: string; readonly latencyMs: number }
  > {
    const start = Date.now();
    try {
      await this.getOrProvisionEvmAccount();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    }
  }

  /**
   * Get cached addresses (undefined if chain not yet provisioned).
   */
  getAddresses(): { evm?: string; svm?: string } {
    return {
      evm: this.cachedEvmAccount?.address,
      svm: this.cachedSolanaAccount?.address,
    };
  }

  private async queryEvmUsdcBalance(
    address: `0x${string}`,
    network: string,
  ): Promise<bigint | undefined> {
    const usdcAddress = EVM_USDC[network];
    if (!usdcAddress) return undefined;

    try {
      const client = await this.resolveClient();
      const result = await client.evm.listTokenBalances({ address, network });
      const usdc = result.balances.find(
        (b) =>
          b.token.contractAddress.toLowerCase() === usdcAddress.toLowerCase(),
      );
      if (!usdc) return 0n;
      return usdcAtomicToCents(usdc.amount.amount);
    } catch {
      // Balance query is best-effort: network or deserialization failures degrade gracefully to unknown balance
      return undefined;
    }
  }

  private async querySolanaUsdcBalance(
    address: string,
    network: string,
  ): Promise<bigint | undefined> {
    const solNetwork = SOLANA_NETWORK[network];
    const usdcMint = solNetwork ? SVM_USDC[solNetwork] : undefined;
    if (!solNetwork || !usdcMint) return undefined;

    try {
      const client = await this.resolveClient();
      const result = await client.solana.listTokenBalances({
        address,
        network: solNetwork,
      });
      const usdc = result.balances.find(
        (b) => b.token.mintAddress === usdcMint,
      );
      if (!usdc) return 0n;
      return usdcAtomicToCents(usdc.amount.amount);
    } catch {
      // Balance query is best-effort: network or deserialization failures degrade gracefully to unknown balance
      return undefined;
    }
  }

  private async resolveClient(): Promise<CdpMultiChainClient> {
    try {
      return await this.createClient();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to create CDP client";
      throw new CdpProvisioningError(msg);
    }
  }
}
