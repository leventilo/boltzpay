import { describe, expect, it } from "vitest";
import type {
  BoltzPayEvents,
  UnsupportedSchemeEvent,
  UnsupportedNetworkEvent,
  WalletSelectedEvent,
} from "../../src/events/types";

describe("protocol/wallet event types", () => {
  it("BoltzPayEvents has protocol:unsupported-scheme entry", () => {
    // TypeScript compilation check: the key must exist in BoltzPayEvents
    const event: BoltzPayEvents["protocol:unsupported-scheme"] = [
      { scheme: "upto", url: "https://example.com" },
    ];
    expect(event[0].scheme).toBe("upto");
    expect(event[0].url).toBe("https://example.com");
  });

  it("BoltzPayEvents has protocol:unsupported-network entry", () => {
    const event: BoltzPayEvents["protocol:unsupported-network"] = [
      { namespace: "stellar", url: "https://example.com" },
    ];
    expect(event[0].namespace).toBe("stellar");
    expect(event[0].url).toBe("https://example.com");
  });

  it("BoltzPayEvents has wallet:selected entry", () => {
    const event: BoltzPayEvents["wallet:selected"] = [
      { walletName: "cdp-evm", network: "evm", reason: "cheapest" },
    ];
    expect(event[0].walletName).toBe("cdp-evm");
    expect(event[0].network).toBe("evm");
    expect(event[0].reason).toBe("cheapest");
  });

  it("UnsupportedSchemeEvent allows optional maxAmount and network", () => {
    const event: UnsupportedSchemeEvent = {
      scheme: "upto",
      url: "https://example.com",
      maxAmount: { cents: 1000n, currency: "USD", toDisplayString: () => "$10.00" } as any,
      network: "eip155:8453",
    };
    expect(event.maxAmount).toBeDefined();
    expect(event.network).toBe("eip155:8453");
  });

  it("UnsupportedNetworkEvent has namespace and url", () => {
    const event: UnsupportedNetworkEvent = {
      namespace: "stellar",
      url: "https://api.example.com/pay",
    };
    expect(event.namespace).toBe("stellar");
  });

  it("WalletSelectedEvent has walletName, network, and reason", () => {
    const event: WalletSelectedEvent = {
      walletName: "cdp-svm",
      network: "svm",
      reason: "only-available",
    };
    expect(event.walletName).toBe("cdp-svm");
  });
});
