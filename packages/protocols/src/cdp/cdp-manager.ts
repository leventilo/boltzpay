import { Mutex } from "async-mutex";
import { CdpProvisioningError } from "../adapter-error";

export interface CdpAccount {
  readonly address: `0x${string}`;
  signTypedData(args: Record<string, unknown>): Promise<`0x${string}`>;
}

export interface CdpClientLike {
  evm: {
    getOrCreateAccount(opts: { name: string }): Promise<CdpAccount>;
  };
}

/** @deprecated Use CdpWalletManager instead — supports both EVM and Solana chains. */
export class CdpManager {
  private readonly mutex = new Mutex();
  private cachedAccount: CdpAccount | undefined;

  constructor(
    private readonly createClient: () => CdpClientLike | Promise<CdpClientLike>,
    private readonly accountName: string,
  ) {}

  async getOrProvisionAccount(): Promise<CdpAccount> {
    return this.mutex.runExclusive(async () => {
      if (this.cachedAccount) {
        return this.cachedAccount;
      }

      let client: CdpClientLike;
      try {
        client = await this.createClient();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to create CDP client";
        throw new CdpProvisioningError(msg);
      }

      try {
        const account = await client.evm.getOrCreateAccount({
          name: this.accountName,
        });
        this.cachedAccount = account;
        return account;
      } catch (err) {
        if (err instanceof CdpProvisioningError) throw err;
        const msg = err instanceof Error ? err.message : "Unknown CDP error";
        throw new CdpProvisioningError(msg);
      }
    });
  }
}
