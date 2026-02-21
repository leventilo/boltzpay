import { describe, expect, it, vi } from "vitest";
import { CdpProvisioningError } from "../../src/adapter-error";
import { type CdpClientLike, CdpManager } from "../../src/cdp/cdp-manager";

const ACCOUNT_NAME = "boltzpay-default";

function mockClient(address = "0xabc123" as `0x${string}`): CdpClientLike {
  return {
    evm: {
      getOrCreateAccount: vi.fn().mockResolvedValue({
        address,
        signTypedData: vi.fn(),
      }),
    },
  };
}

describe("CdpManager", () => {
  describe("getOrProvisionAccount", () => {
    it("should provision new account with accountName", async () => {
      const client = mockClient();
      const manager = new CdpManager(() => client, ACCOUNT_NAME);

      const account = await manager.getOrProvisionAccount();

      expect(account.address).toBe("0xabc123");
      expect(client.evm.getOrCreateAccount).toHaveBeenCalledWith({
        name: ACCOUNT_NAME,
      });
    });

    it("should return cached account on subsequent calls", async () => {
      const client = mockClient();
      const manager = new CdpManager(() => client, ACCOUNT_NAME);

      const first = await manager.getOrProvisionAccount();
      const second = await manager.getOrProvisionAccount();

      expect(first).toBe(second);
      expect(client.evm.getOrCreateAccount).toHaveBeenCalledTimes(1);
    });

    it("should throw CdpProvisioningError on client creation failure", async () => {
      const manager = new CdpManager(() => {
        throw new Error("Client init failed");
      }, ACCOUNT_NAME);

      await expect(manager.getOrProvisionAccount()).rejects.toThrow(
        CdpProvisioningError,
      );
    });

    it("should throw CdpProvisioningError on account creation failure", async () => {
      const client: CdpClientLike = {
        evm: {
          getOrCreateAccount: vi.fn().mockRejectedValue(new Error("CDP down")),
        },
      };
      const manager = new CdpManager(() => client, ACCOUNT_NAME);

      await expect(manager.getOrProvisionAccount()).rejects.toThrow(
        CdpProvisioningError,
      );
    });

    it("should re-throw CdpProvisioningError without wrapping", async () => {
      const originalError = new CdpProvisioningError("Already failing");
      const client: CdpClientLike = {
        evm: {
          getOrCreateAccount: vi.fn().mockRejectedValue(originalError),
        },
      };
      const manager = new CdpManager(() => client, ACCOUNT_NAME);

      await expect(manager.getOrProvisionAccount()).rejects.toBe(originalError);
    });
  });

  describe("mutex serialization", () => {
    it("should serialize concurrent calls and cache after first", async () => {
      const slowClient: CdpClientLike = {
        evm: {
          getOrCreateAccount: vi.fn().mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 30));
            return {
              address: "0xabc123" as `0x${string}`,
              signTypedData: vi.fn(),
            };
          }),
        },
      };

      const manager = new CdpManager(() => slowClient, ACCOUNT_NAME);

      await Promise.all([
        manager.getOrProvisionAccount(),
        manager.getOrProvisionAccount(),
      ]);

      // Only one actual call due to caching
      expect(slowClient.evm.getOrCreateAccount).toHaveBeenCalledTimes(1);
    });
  });
});
