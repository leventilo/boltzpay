import { Money } from "@boltzpay/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetOrProvisionEvmAccount = vi.fn();
const mockGetBalancesWallet = vi.fn();
const mockGetAddresses = vi.fn();
const mockGetBalance = vi.fn();

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
  class MockL402Adapter {
    name = "l402";
    constructor() {}
  }
  class MockNwcWalletManager {
    getBalance = mockGetBalance;
    close = vi.fn();
    constructor() {}
  }
  class MockAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
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

const NWC_STRING = "nostr+walletconnect://relay.example.com?secret=abc123";

const COINBASE_CONFIG = {
  coinbaseApiKeyId: "test-key-id-abcd",
  coinbaseApiKeySecret: "test-secret",
  coinbaseWalletSecret: "test-wallet",
};

describe("getWalletStatus — Lightning", () => {
  beforeEach(() => {
    mockGetOrProvisionEvmAccount.mockReset();
    mockGetBalancesWallet.mockReset().mockResolvedValue({});
    mockGetAddresses.mockReset().mockReturnValue({});
    mockGetBalance.mockReset();
  });

  it("returns undefined lightning when NWC is not configured", async () => {
    const sdk = new BoltzPay({});
    const status = await sdk.getWalletStatus();

    expect(status.lightning).toBeUndefined();
  });

  it("returns connected status with balance when NWC succeeds", async () => {
    mockGetBalance.mockResolvedValue({ balanceSats: 4800n });

    const sdk = new BoltzPay({ nwcConnectionString: NWC_STRING });
    const status = await sdk.getWalletStatus();

    expect(status.lightning).toBeDefined();
    expect(status.lightning?.configured).toBe(true);
    expect(status.lightning?.connection.status).toBe("connected");
    expect(status.lightning?.connection.latencyMs).toBeGreaterThanOrEqual(0);
    expect(status.lightning?.balance?.sats).toBe(4800n);
    sdk.close();
  });

  it("returns error status when NWC getBalance fails", async () => {
    mockGetBalance.mockRejectedValue(new Error("NWC connection timeout"));

    const sdk = new BoltzPay({ nwcConnectionString: NWC_STRING });
    const status = await sdk.getWalletStatus();

    expect(status.lightning).toBeDefined();
    expect(status.lightning?.configured).toBe(true);
    expect(status.lightning?.connection.status).toBe("error");
    expect(status.lightning?.connection.error).toBe("NWC connection timeout");
    expect(status.lightning?.balance).toBeUndefined();
    sdk.close();
  });

  it("includes lightning status alongside Coinbase status", async () => {
    mockGetOrProvisionEvmAccount.mockResolvedValue({ address: "0xabc" });
    mockGetBalancesWallet.mockResolvedValue({
      evm: { address: "0xabc", balanceUsdcCents: 500n },
    });
    mockGetBalance.mockResolvedValue({ balanceSats: 1200n });

    const sdk = new BoltzPay({
      ...COINBASE_CONFIG,
      nwcConnectionString: NWC_STRING,
    });
    const status = await sdk.getWalletStatus();

    expect(status.canPay).toBe(true);
    expect(status.connection.status).toBe("connected");
    expect(status.accounts.evm?.balance?.equals(Money.fromCents(500n))).toBe(
      true,
    );

    expect(status.lightning?.configured).toBe(true);
    expect(status.lightning?.connection.status).toBe("connected");
    expect(status.lightning?.balance?.sats).toBe(1200n);
    sdk.close();
  });

  it("formats balance display correctly", async () => {
    mockGetBalance.mockResolvedValue({ balanceSats: 4800n });

    const sdk = new BoltzPay({ nwcConnectionString: NWC_STRING });
    const status = await sdk.getWalletStatus();

    expect(status.lightning?.balance?.display).toBe("4800 sats");
    sdk.close();
  });

  it("probes lightning even when Coinbase is not configured", async () => {
    mockGetBalance.mockResolvedValue({ balanceSats: 250n });

    const sdk = new BoltzPay({ nwcConnectionString: NWC_STRING });
    const status = await sdk.getWalletStatus();

    expect(status.canPay).toBe(false);
    expect(status.connection.status).toBe("skipped");
    expect(status.credentials.coinbase.configured).toBe(false);

    expect(status.lightning?.configured).toBe(true);
    expect(status.lightning?.connection.status).toBe("connected");
    expect(status.lightning?.balance?.sats).toBe(250n);
    expect(status.lightning?.balance?.display).toBe("250 sats");
    sdk.close();
  });
});
