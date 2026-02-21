import { describe, expect, it, vi } from "vitest";
import type { Address, SignatureBytes, Transaction } from "@solana/kit";
import type { CdpSolanaAccount } from "../../src/cdp/cdp-svm-signer";
import { CdpSvmSigner } from "../../src/cdp/cdp-svm-signer";

// Mock @solana/kit transaction encoder/decoder
// We mock at the module level so CdpSvmSigner's imports resolve to our mocks.
vi.mock("@solana/kit", async () => {
  return {
    getTransactionEncoder: () => ({
      encode: (tx: Transaction) => {
        // Return a deterministic byte array from messageBytes
        return tx.messageBytes;
      },
    }),
    getTransactionDecoder: () => ({
      decode: (bytes: Uint8Array) => {
        // Simulate: the signed transaction contains a new signature
        // The mock CDP returns "signed-base64" which decodes to specific bytes.
        // We decode back to a Transaction with a known signature.
        return {
          messageBytes: bytes,
          signatures: {
            ["5xyzSolanaAddr" as Address]: new Uint8Array(64).fill(
              0xab,
            ) as unknown as SignatureBytes,
          },
        } satisfies Transaction;
      },
    }),
  };
});

const SOLANA_ADDRESS = "5xyzSolanaAddr";

function mockCdpSolanaAccount(
  address = SOLANA_ADDRESS,
): CdpSolanaAccount {
  return {
    address,
    signTransaction: vi.fn().mockImplementation(async () => {
      // Return a base64-encoded "signed transaction"
      // In reality CDP would modify the transaction bytes with a signature
      return { signedTransaction: Buffer.from(new Uint8Array(64).fill(0xab)).toString("base64") };
    }),
  };
}

function mockTransaction(): Transaction {
  return {
    messageBytes: new Uint8Array([1, 2, 3, 4]) as unknown as Transaction["messageBytes"],
    signatures: {} as Transaction["signatures"],
  };
}

describe("CdpSvmSigner", () => {
  it("should expose address from CDP account", () => {
    const cdpAccount = mockCdpSolanaAccount();
    const signer = new CdpSvmSigner(cdpAccount);

    expect(signer.address).toBe(SOLANA_ADDRESS);
  });

  it("should call CDP signTransaction once for single transaction", async () => {
    const cdpAccount = mockCdpSolanaAccount();
    const signer = new CdpSvmSigner(cdpAccount);
    const tx = mockTransaction();

    await signer.signTransactions([tx]);

    expect(cdpAccount.signTransaction).toHaveBeenCalledTimes(1);
    expect(cdpAccount.signTransaction).toHaveBeenCalledWith({
      transaction: expect.any(String),
      address: SOLANA_ADDRESS,
    });
  });

  it("should call CDP signTransaction for each transaction", async () => {
    const cdpAccount = mockCdpSolanaAccount();
    const signer = new CdpSvmSigner(cdpAccount);
    const tx1 = mockTransaction();
    const tx2 = mockTransaction();

    const results = await signer.signTransactions([tx1, tx2]);

    expect(cdpAccount.signTransaction).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });

  it("should return SignatureDictionary with signer address", async () => {
    const cdpAccount = mockCdpSolanaAccount();
    const signer = new CdpSvmSigner(cdpAccount);
    const tx = mockTransaction();

    const [sigDict] = await signer.signTransactions([tx]);

    // Our mock decoder returns signatures keyed by the CDP account address
    expect(sigDict).toBeDefined();
    expect(sigDict![SOLANA_ADDRESS as Address]).toBeDefined();
  });

  it("should return empty array for empty transactions", async () => {
    const cdpAccount = mockCdpSolanaAccount();
    const signer = new CdpSvmSigner(cdpAccount);

    const result = await signer.signTransactions([]);

    expect(result).toEqual([]);
    expect(cdpAccount.signTransaction).not.toHaveBeenCalled();
  });

  it("should propagate CDP signTransaction errors", async () => {
    const cdpAccount: CdpSolanaAccount = {
      address: SOLANA_ADDRESS,
      signTransaction: vi
        .fn()
        .mockRejectedValue(new Error("CDP signing failed")),
    };
    const signer = new CdpSvmSigner(cdpAccount);
    const tx = mockTransaction();

    await expect(signer.signTransactions([tx])).rejects.toThrow(
      "CDP signing failed",
    );
  });
});
