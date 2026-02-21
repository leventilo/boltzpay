import { describe, expect, it, vi } from "vitest";
import { CdpProvisioningError } from "../../src/adapter-error";
import type { CdpAccount } from "../../src/cdp/cdp-manager";
import type { CdpSolanaAccount } from "../../src/cdp/cdp-svm-signer";
import {
  type CdpMultiChainClient,
  CdpWalletManager,
} from "../../src/cdp/cdp-wallet-manager";

const ACCOUNT_NAME = "boltzpay-default";

function mockSolanaAccount(
  address = "5xyzSolanaAddr",
): CdpSolanaAccount {
  return {
    address,
    signTransaction: vi.fn().mockResolvedValue({
      signedTransaction: "signed-base64",
    }),
  };
}

function mockEvmAccount(
  address = "0xabc123" as `0x${string}`,
): CdpAccount {
  return {
    address,
    signTypedData: vi.fn().mockResolvedValue("0xsig" as `0x${string}`),
  };
}

function mockMultiChainClient(
  evmAccount?: CdpAccount,
  solanaAccount?: CdpSolanaAccount,
): CdpMultiChainClient {
  return {
    evm: {
      getOrCreateAccount: vi
        .fn()
        .mockResolvedValue(evmAccount ?? mockEvmAccount()),
      listTokenBalances: vi.fn().mockResolvedValue({ balances: [] }),
    },
    solana: {
      createAccount: vi
        .fn()
        .mockResolvedValue(solanaAccount ?? mockSolanaAccount()),
      listTokenBalances: vi.fn().mockResolvedValue({ balances: [] }),
    },
  };
}

describe("CdpWalletManager", () => {
  describe("getOrProvisionEvmAccount", () => {
    it("should provision EVM account with correct address", async () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      const account = await manager.getOrProvisionEvmAccount();

      expect(account.address).toBe("0xabc123");
      expect(client.evm.getOrCreateAccount).toHaveBeenCalledWith({
        name: ACCOUNT_NAME,
      });
    });

    it("should cache EVM account on subsequent calls", async () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      const first = await manager.getOrProvisionEvmAccount();
      const second = await manager.getOrProvisionEvmAccount();

      expect(first).toBe(second);
      expect(client.evm.getOrCreateAccount).toHaveBeenCalledTimes(1);
    });

    it("should throw CdpProvisioningError on EVM creation failure", async () => {
      const client: CdpMultiChainClient = {
        evm: {
          getOrCreateAccount: vi
            .fn()
            .mockRejectedValue(new Error("EVM provisioning down")),
          listTokenBalances: vi.fn().mockResolvedValue({ balances: [] }),
        },
        solana: {
          createAccount: vi.fn(),
          listTokenBalances: vi.fn().mockResolvedValue({ balances: [] }),
        },
      };
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await expect(manager.getOrProvisionEvmAccount()).rejects.toThrow(
        CdpProvisioningError,
      );
    });
  });

  describe("getOrProvisionSolanaAccount", () => {
    it("should provision Solana account with correct address", async () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      const account = await manager.getOrProvisionSolanaAccount();

      expect(account.address).toBe("5xyzSolanaAddr");
      expect(client.solana.createAccount).toHaveBeenCalledTimes(1);
    });

    it("should cache Solana account on subsequent calls", async () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      const first = await manager.getOrProvisionSolanaAccount();
      const second = await manager.getOrProvisionSolanaAccount();

      expect(first).toBe(second);
      expect(client.solana.createAccount).toHaveBeenCalledTimes(1);
    });

    it("should throw CdpProvisioningError on Solana creation failure", async () => {
      const client: CdpMultiChainClient = {
        evm: {
          getOrCreateAccount: vi.fn(),
          listTokenBalances: vi.fn().mockResolvedValue({ balances: [] }),
        },
        solana: {
          createAccount: vi
            .fn()
            .mockRejectedValue(new Error("Solana provisioning down")),
          listTokenBalances: vi.fn().mockResolvedValue({ balances: [] }),
        },
      };
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await expect(manager.getOrProvisionSolanaAccount()).rejects.toThrow(
        CdpProvisioningError,
      );
    });

    it("should serialize concurrent Solana calls via mutex", async () => {
      const slowSolana = mockSolanaAccount();
      const client: CdpMultiChainClient = {
        evm: {
          getOrCreateAccount: vi.fn(),
          listTokenBalances: vi.fn().mockResolvedValue({ balances: [] }),
        },
        solana: {
          createAccount: vi.fn().mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 30));
            return slowSolana;
          }),
          listTokenBalances: vi.fn().mockResolvedValue({ balances: [] }),
        },
      };
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await Promise.all([
        manager.getOrProvisionSolanaAccount(),
        manager.getOrProvisionSolanaAccount(),
      ]);

      // Only one actual call due to mutex + caching
      expect(client.solana.createAccount).toHaveBeenCalledTimes(1);
    });
  });

  describe("getSvmSigner", () => {
    it("should return a signer with address property", async () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      const signer = await manager.getSvmSigner();

      expect(signer.address).toBe("5xyzSolanaAddr");
    });
  });

  describe("getBalances", () => {
    it("should return empty when no accounts provisioned", async () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      const balances = await manager.getBalances("base");

      expect(balances.evm).toBeUndefined();
      expect(balances.svm).toBeUndefined();
    });

    it("should return 0 cents when USDC token not found", async () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await manager.getOrProvisionEvmAccount();
      const balances = await manager.getBalances("base");

      expect(balances.evm).toEqual({
        address: "0xabc123",
        balanceUsdcCents: 0n,
      });
    });

    it("should return real USDC balance from EVM listTokenBalances", async () => {
      const client = mockMultiChainClient();
      (client.evm.listTokenBalances as ReturnType<typeof vi.fn>).mockResolvedValue({
        balances: [
          {
            token: { contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
            amount: { amount: 5_000_000n, decimals: 6 },
          },
        ],
      });
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await manager.getOrProvisionEvmAccount();
      const balances = await manager.getBalances("base");

      // 5_000_000 atomic USDC = 500 cents ($5.00)
      expect(balances.evm?.balanceUsdcCents).toBe(500n);
    });

    it("should return real USDC balance from Solana listTokenBalances", async () => {
      const client = mockMultiChainClient();
      (client.solana.listTokenBalances as ReturnType<typeof vi.fn>).mockResolvedValue({
        balances: [
          {
            token: { mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
            amount: { amount: 1_000_000n, decimals: 6 },
          },
        ],
      });
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await manager.getOrProvisionSolanaAccount();
      const balances = await manager.getBalances("base");

      // 1_000_000 atomic USDC = 100 cents ($1.00)
      expect(balances.svm?.balanceUsdcCents).toBe(100n);
    });

    it("should return undefined balance on API error (graceful degradation)", async () => {
      const client = mockMultiChainClient();
      (client.evm.listTokenBalances as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("API timeout"),
      );
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await manager.getOrProvisionEvmAccount();
      const balances = await manager.getBalances("base");

      expect(balances.evm).toEqual({
        address: "0xabc123",
        balanceUsdcCents: undefined,
      });
    });

    it("should handle concurrent getBalances calls without double provisioning", async () => {
      const slowEvm = mockEvmAccount();
      const slowSolana = mockSolanaAccount();
      const client: CdpMultiChainClient = {
        evm: {
          getOrCreateAccount: vi.fn().mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 30));
            return slowEvm;
          }),
          listTokenBalances: vi.fn().mockResolvedValue({ balances: [] }),
        },
        solana: {
          createAccount: vi.fn().mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 30));
            return slowSolana;
          }),
          listTokenBalances: vi.fn().mockResolvedValue({ balances: [] }),
        },
      };
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      // Provision both chains first (concurrently)
      await Promise.all([
        manager.getOrProvisionEvmAccount(),
        manager.getOrProvisionSolanaAccount(),
      ]);

      // Now launch 3 concurrent getBalances calls
      const [b1, b2, b3] = await Promise.all([
        manager.getBalances("base"),
        manager.getBalances("base"),
        manager.getBalances("base"),
      ]);

      // Provisioning should only have been called once per chain
      expect(client.evm.getOrCreateAccount).toHaveBeenCalledTimes(1);
      expect(client.solana.createAccount).toHaveBeenCalledTimes(1);

      // All 3 results should be identical
      expect(b1).toEqual(b2);
      expect(b2).toEqual(b3);
      expect(b1.evm).toEqual({ address: "0xabc123", balanceUsdcCents: 0n });
      expect(b1.svm).toEqual({ address: "5xyzSolanaAddr", balanceUsdcCents: 0n });
    });

    it("should return both chain balances after both provisioned", async () => {
      const client = mockMultiChainClient();
      (client.evm.listTokenBalances as ReturnType<typeof vi.fn>).mockResolvedValue({
        balances: [
          {
            token: { contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
            amount: { amount: 10_000_000n, decimals: 6 },
          },
        ],
      });
      (client.solana.listTokenBalances as ReturnType<typeof vi.fn>).mockResolvedValue({
        balances: [
          {
            token: { mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
            amount: { amount: 2_500_000n, decimals: 6 },
          },
        ],
      });
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await manager.getOrProvisionEvmAccount();
      await manager.getOrProvisionSolanaAccount();
      const balances = await manager.getBalances("base");

      expect(balances.evm).toEqual({
        address: "0xabc123",
        balanceUsdcCents: 1000n, // $10.00
      });
      expect(balances.svm).toEqual({
        address: "5xyzSolanaAddr",
        balanceUsdcCents: 250n, // $2.50
      });
    });

    it("should use correct USDC addresses for base-sepolia network", async () => {
      const client = mockMultiChainClient();
      (client.evm.listTokenBalances as ReturnType<typeof vi.fn>).mockResolvedValue({
        balances: [
          {
            token: { contractAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
            amount: { amount: 50_000n, decimals: 6 },
          },
        ],
      });
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await manager.getOrProvisionEvmAccount();
      const balances = await manager.getBalances("base-sepolia");

      expect(balances.evm?.balanceUsdcCents).toBe(5n); // 50_000 atomic = 5 cents
      expect(client.evm.listTokenBalances).toHaveBeenCalledWith({
        address: "0xabc123",
        network: "base-sepolia",
      });
    });
  });

  describe("getAddresses", () => {
    it("should return undefined for both before provisioning", () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      const addresses = manager.getAddresses();

      expect(addresses.evm).toBeUndefined();
      expect(addresses.svm).toBeUndefined();
    });

    it("should return addresses after provisioning", async () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await manager.getOrProvisionEvmAccount();
      await manager.getOrProvisionSolanaAccount();
      const addresses = manager.getAddresses();

      expect(addresses.evm).toBe("0xabc123");
      expect(addresses.svm).toBe("5xyzSolanaAddr");
    });
  });

  describe("testConnectivity", () => {
    it("should return ok true when EVM provisioning succeeds", async () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      const result = await manager.testConnectivity();

      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should return ok false with error message when provisioning fails", async () => {
      const manager = new CdpWalletManager(() => {
        throw new Error("Invalid API key");
      }, ACCOUNT_NAME);

      const result = await manager.testConnectivity();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Invalid API key");
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should be fast on second call due to cached account", async () => {
      const client = mockMultiChainClient();
      const manager = new CdpWalletManager(() => client, ACCOUNT_NAME);

      await manager.testConnectivity();
      const second = await manager.testConnectivity();

      expect(second.ok).toBe(true);
      expect(client.evm.getOrCreateAccount).toHaveBeenCalledTimes(1);
    });
  });

  describe("client creation failure", () => {
    it("should throw CdpProvisioningError when client factory fails", async () => {
      const manager = new CdpWalletManager(() => {
        throw new Error("Client init failed");
      }, ACCOUNT_NAME);

      await expect(manager.getOrProvisionEvmAccount()).rejects.toThrow(
        CdpProvisioningError,
      );
    });

    it("should throw CdpProvisioningError for Solana when client factory fails", async () => {
      const manager = new CdpWalletManager(() => {
        throw new Error("Client init failed");
      }, ACCOUNT_NAME);

      await expect(manager.getOrProvisionSolanaAccount()).rejects.toThrow(
        CdpProvisioningError,
      );
    });
  });
});
