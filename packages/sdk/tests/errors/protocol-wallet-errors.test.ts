import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import { BoltzPayError } from "../../src/errors/boltzpay-error";
import { UnsupportedSchemeError } from "../../src/errors/unsupported-scheme-error";
import { UnsupportedNetworkError } from "../../src/errors/unsupported-network-error";
import { NoWalletError } from "../../src/errors/no-wallet-error";

describe("UnsupportedSchemeError", () => {
  it("extends BoltzPayError", () => {
    const err = new UnsupportedSchemeError({ scheme: "upto" });
    expect(err).toBeInstanceOf(BoltzPayError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has code "unsupported_scheme" and statusCode 501', () => {
    const err = new UnsupportedSchemeError({ scheme: "upto" });
    expect(err.code).toBe("unsupported_scheme");
    expect(err.statusCode).toBe(501);
  });

  it('has name "UnsupportedSchemeError"', () => {
    const err = new UnsupportedSchemeError({ scheme: "upto" });
    expect(err.name).toBe("UnsupportedSchemeError");
  });

  it("message includes the scheme name", () => {
    const err = new UnsupportedSchemeError({ scheme: "upto" });
    expect(err.message).toContain("upto");
  });

  it("message includes GitHub tracking link", () => {
    const err = new UnsupportedSchemeError({ scheme: "upto" });
    expect(err.message).toContain("github.com");
  });

  it("exposes scheme, maxAmount, and network properties", () => {
    const maxAmount = Money.fromDollars("10.00");
    const err = new UnsupportedSchemeError({
      scheme: "upto",
      maxAmount,
      network: "eip155:8453",
    });
    expect(err.scheme).toBe("upto");
    expect(err.maxAmount).toBe(maxAmount);
    expect(err.network).toBe("eip155:8453");
  });

  it("maxAmount and network are optional", () => {
    const err = new UnsupportedSchemeError({ scheme: "upto" });
    expect(err.maxAmount).toBeUndefined();
    expect(err.network).toBeUndefined();
  });
});

describe("UnsupportedNetworkError", () => {
  it("extends BoltzPayError", () => {
    const err = new UnsupportedNetworkError("stellar");
    expect(err).toBeInstanceOf(BoltzPayError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has code "unsupported_network" and statusCode 501', () => {
    const err = new UnsupportedNetworkError("stellar");
    expect(err.code).toBe("unsupported_network");
    expect(err.statusCode).toBe(501);
  });

  it('has name "UnsupportedNetworkError"', () => {
    const err = new UnsupportedNetworkError("stellar");
    expect(err.name).toBe("UnsupportedNetworkError");
  });

  it("message includes the namespace", () => {
    const err = new UnsupportedNetworkError("stellar");
    expect(err.message).toContain("stellar");
  });

  it("exposes namespace property", () => {
    const err = new UnsupportedNetworkError("stellar");
    expect(err.namespace).toBe("stellar");
  });
});

describe("NoWalletError", () => {
  it("extends BoltzPayError", () => {
    const err = new NoWalletError("stellar", ["evm", "svm"]);
    expect(err).toBeInstanceOf(BoltzPayError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has code "no_wallet_available" and statusCode 424', () => {
    const err = new NoWalletError("stellar", ["evm", "svm"]);
    expect(err.code).toBe("no_wallet_available");
    expect(err.statusCode).toBe(424);
  });

  it('has name "NoWalletError"', () => {
    const err = new NoWalletError("stellar", ["evm", "svm"]);
    expect(err.name).toBe("NoWalletError");
  });

  it("message includes requested network", () => {
    const err = new NoWalletError("stellar", ["evm", "svm"]);
    expect(err.message).toContain("stellar");
  });

  it("message lists available networks", () => {
    const err = new NoWalletError("stellar", ["evm", "svm"]);
    expect(err.message).toContain("evm");
    expect(err.message).toContain("svm");
  });

  it("exposes requestedNetwork and availableNetworks", () => {
    const err = new NoWalletError("stellar", ["evm", "svm"]);
    expect(err.requestedNetwork).toBe("stellar");
    expect(err.availableNetworks).toEqual(["evm", "svm"]);
  });

  it("handles empty availableNetworks", () => {
    const err = new NoWalletError("stellar", []);
    expect(err.availableNetworks).toEqual([]);
    expect(err.message).toContain("stellar");
  });
});
