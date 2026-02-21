import { Money } from "@boltzpay/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetOrProvisionEvmAccount = vi.fn();
const mockGetBalancesWallet = vi.fn();
const mockGetAddresses = vi.fn();

vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {},
}));

vi.mock("@boltzpay/protocols", () => {
  class MockCdpWalletManager {
    getOrProvisionEvmAccount = mockGetOrProvisionEvmAccount;
    getBalances = mockGetBalancesWallet;
    getAddresses = mockGetAddresses.mockReturnValue({});
  }
  class MockProtocolRouter {
    probeAll() {
      return Promise.reject(new Error("Not implemented in test"));
    }
    execute() {
      return Promise.reject(new Error("Not implemented in test"));
    }
  }
  class MockX402Adapter {
    name = "x402";
  }
  class MockAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  class MockL402Adapter {
    name = "l402";
    constructor() {}
  }
  class MockNwcWalletManager {
    constructor() {}
  }
  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: MockX402Adapter,
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
  };
});

import { BoltzPay } from "../src/boltzpay";

const COINBASE_CONFIG = {
  coinbaseApiKeyId: "test-key-id-abcd",
  coinbaseApiKeySecret: "test-secret",
  coinbaseWalletSecret: "test-wallet",
};

describe("getWalletStatus", () => {
  beforeEach(() => {
    mockGetOrProvisionEvmAccount.mockReset();
    mockGetBalancesWallet.mockReset().mockResolvedValue({});
    mockGetAddresses.mockReset().mockReturnValue({});
  });

  it("should return skipped connection when no credentials", async () => {
    const sdk = new BoltzPay({});
    const status = await sdk.getWalletStatus();

    expect(status.canPay).toBe(false);
    expect(status.connection.status).toBe("skipped");
    expect(status.credentials.coinbase.configured).toBe(false);
    expect(status.credentials.coinbase.keyHint).toBeUndefined();
    expect(status.accounts.evm).toBeUndefined();
    expect(status.accounts.svm).toBeUndefined();
  });

  it("should return connected status when provisioning succeeds", async () => {
    mockGetOrProvisionEvmAccount.mockResolvedValue({
      address: "0xabc123",
    });
    mockGetBalancesWallet.mockResolvedValue({
      evm: { address: "0xabc123", balanceUsdcCents: 500n },
    });

    const sdk = new BoltzPay(COINBASE_CONFIG);
    const status = await sdk.getWalletStatus();

    expect(status.canPay).toBe(true);
    expect(status.connection.status).toBe("connected");
    if (status.connection.status === "connected") {
      expect(status.connection.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(status.accounts.evm?.address).toBe("0xabc123");
    expect(status.accounts.evm?.balance?.equals(Money.fromCents(500n))).toBe(
      true,
    );
  });

  it("should return error status when provisioning fails", async () => {
    mockGetOrProvisionEvmAccount.mockRejectedValue(
      new Error("Invalid API key"),
    );

    const sdk = new BoltzPay(COINBASE_CONFIG);
    const status = await sdk.getWalletStatus();

    expect(status.canPay).toBe(true);
    expect(status.connection.status).toBe("error");
    if (status.connection.status === "error") {
      expect(status.connection.error).toBe("Invalid API key");
    }
    expect(status.accounts.evm).toBeUndefined();
  });

  it("should mask API key to last 4 characters", async () => {
    mockGetOrProvisionEvmAccount.mockResolvedValue({ address: "0xabc" });
    mockGetBalancesWallet.mockResolvedValue({});

    const sdk = new BoltzPay(COINBASE_CONFIG);
    const status = await sdk.getWalletStatus();

    expect(status.credentials.coinbase.configured).toBe(true);
    expect(status.credentials.coinbase.keyHint).toBe("…abcd");
  });

  it("should detect testnet for base-sepolia", async () => {
    const sdk = new BoltzPay({ network: "base-sepolia" });
    const status = await sdk.getWalletStatus();

    expect(status.isTestnet).toBe(true);
    expect(status.network).toBe("base-sepolia");
  });

  it("should detect mainnet for base", async () => {
    const sdk = new BoltzPay({});
    const status = await sdk.getWalletStatus();

    expect(status.isTestnet).toBe(false);
    expect(status.network).toBe("base");
  });

  it("should include budget state", async () => {
    const sdk = new BoltzPay({
      budget: { daily: 10, monthly: 100 },
    });
    const status = await sdk.getWalletStatus();

    expect(status.budget.dailyLimit?.equals(Money.fromDollars("10.00"))).toBe(
      true,
    );
    expect(
      status.budget.monthlyLimit?.equals(Money.fromDollars("100.00")),
    ).toBe(true);
  });
});
