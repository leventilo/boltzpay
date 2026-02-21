import type {
  Address,
  SignatureBytes,
  Transaction,
  TransactionPartialSigner,
  TransactionPartialSignerConfig,
} from "@solana/kit";
import { getTransactionDecoder, getTransactionEncoder } from "@solana/kit";

/**
 * Minimal interface matching CDP SDK's Solana account signing capability.
 * Decoupled from the concrete CDP SDK type for testability.
 */
export interface CdpSolanaAccount {
  readonly address: string;
  signTransaction(args: {
    transaction: string;
    address?: string;
  }): Promise<{ signedTransaction: string }>;
}

/**
 * Adapter bridging CDP SDK's SolanaAccount to @solana/kit's TransactionPartialSigner interface.
 *
 * The x402 SVM scheme expects a TransactionSigner (union of Partial | Modifying | Sending).
 * We implement TransactionPartialSigner — the simplest variant — which signs transactions
 * in parallel without modifying them, returning a SignatureDictionary per transaction.
 *
 * Flow per transaction:
 * 1. Encode Transaction -> bytes via getTransactionEncoder()
 * 2. Base64-encode bytes -> send to CDP signTransaction({ transaction: base64 })
 * 3. CDP returns { signedTransaction: base64 } -> decode -> extract new signatures
 */
export class CdpSvmSigner implements TransactionPartialSigner {
  readonly address: Address;

  constructor(private readonly cdpAccount: CdpSolanaAccount) {
    // Address brand type from plain string — CDP SDK returns string, @solana/kit expects branded Address
    this.address = cdpAccount.address as Address;
  }

  async signTransactions(
    transactions: readonly Transaction[],
    _config?: TransactionPartialSignerConfig,
  ): Promise<readonly Record<Address, SignatureBytes>[]> {
    const encoder = getTransactionEncoder();
    const decoder = getTransactionDecoder();

    const results = await Promise.all(
      transactions.map(async (tx) => {
        const txBytes = encoder.encode(tx);
        const base64Tx = Buffer.from(txBytes).toString("base64");

        const { signedTransaction } = await this.cdpAccount.signTransaction({
          transaction: base64Tx,
          address: this.cdpAccount.address,
        });

        const signedBytes = Buffer.from(signedTransaction, "base64");
        const signedTx = decoder.decode(new Uint8Array(signedBytes));

        const sigDict: Record<Address, SignatureBytes> = {};
        for (const [addr, sig] of Object.entries(signedTx.signatures)) {
          if (sig !== null) {
            // Address brand from Object.entries string key — structurally valid address
            sigDict[addr as Address] = sig;
          }
        }

        return sigDict;
      }),
    );

    return results;
  }
}
