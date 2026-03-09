import { describe, expect, it } from "vitest";
import {
  formatNetworkIdentifier,
  parseNetworkIdentifier,
  SUPPORTED_NAMESPACES,
} from "../../src/shared/chain-types";
import { InvalidNetworkIdentifierError } from "../../src/shared/payment-errors";

describe("SUPPORTED_NAMESPACES", () => {
  it("includes stellar", () => {
    expect(SUPPORTED_NAMESPACES).toContain("stellar");
  });

  it("has evm, svm, and stellar", () => {
    expect([...SUPPORTED_NAMESPACES]).toEqual(["evm", "svm", "stellar"]);
  });
});

describe("parseNetworkIdentifier", () => {
  it('parses EVM Base mainnet "eip155:8453"', () => {
    const result = parseNetworkIdentifier("eip155:8453");
    expect(result).toEqual({ namespace: "evm", reference: "8453" });
  });

  it('parses Solana mainnet "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"', () => {
    const result = parseNetworkIdentifier(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    );
    expect(result).toEqual({
      namespace: "svm",
      reference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    });
  });

  it('parses Ethereum mainnet "eip155:1"', () => {
    const result = parseNetworkIdentifier("eip155:1");
    expect(result).toEqual({ namespace: "evm", reference: "1" });
  });

  it('parses Solana devnet "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"', () => {
    const result = parseNetworkIdentifier(
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    );
    expect(result).toEqual({
      namespace: "svm",
      reference: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    });
  });

  it('throws on "invalid" (no colon separator)', () => {
    expect(() => parseNetworkIdentifier("invalid")).toThrow();
  });

  it('throws on "unknown:123" (unsupported namespace)', () => {
    expect(() => parseNetworkIdentifier("unknown:123")).toThrow();
  });

  it('throws on "" (empty string)', () => {
    expect(() => parseNetworkIdentifier("")).toThrow();
  });

  it("throws on eip155 with non-numeric reference", () => {
    expect(() => parseNetworkIdentifier("eip155:abc")).toThrow();
  });

  it("throws on eip155 with empty reference", () => {
    expect(() => parseNetworkIdentifier("eip155:")).toThrow();
  });

  it("throws on solana with empty reference", () => {
    expect(() => parseNetworkIdentifier("solana:")).toThrow();
  });

  it("should reject Solana reference with excluded Base58 character '0'", () => {
    expect(() => parseNetworkIdentifier("solana:0invalidref")).toThrow(
      InvalidNetworkIdentifierError,
    );
  });

  it("should reject Solana reference with excluded Base58 character 'I'", () => {
    expect(() => parseNetworkIdentifier("solana:InvalidWithI")).toThrow(
      InvalidNetworkIdentifierError,
    );
  });

  it("should reject Solana reference with excluded Base58 character 'O'", () => {
    expect(() => parseNetworkIdentifier("solana:BadRefWithO")).toThrow(
      InvalidNetworkIdentifierError,
    );
  });

  it("should reject Solana reference with excluded Base58 character 'l'", () => {
    expect(() => parseNetworkIdentifier("solana:badreflower")).toThrow(
      InvalidNetworkIdentifierError,
    );
  });

  // Stellar namespace tests
  it('parses Stellar pubnet "stellar:pubnet"', () => {
    const result = parseNetworkIdentifier("stellar:pubnet");
    expect(result).toEqual({ namespace: "stellar", reference: "pubnet" });
  });

  it('parses Stellar testnet "stellar:testnet"', () => {
    const result = parseNetworkIdentifier("stellar:testnet");
    expect(result).toEqual({ namespace: "stellar", reference: "testnet" });
  });

  it('parses Stellar custom reference "stellar:custom-ref"', () => {
    const result = parseNetworkIdentifier("stellar:custom-ref");
    expect(result).toEqual({ namespace: "stellar", reference: "custom-ref" });
  });

  it('throws on "stellar:" (empty reference)', () => {
    expect(() => parseNetworkIdentifier("stellar:")).toThrow(
      InvalidNetworkIdentifierError,
    );
  });
});

describe("formatNetworkIdentifier", () => {
  it("formats EVM to CAIP-2", () => {
    const result = formatNetworkIdentifier({
      namespace: "evm",
      reference: "8453",
    });
    expect(result).toBe("eip155:8453");
  });

  it("formats SVM to CAIP-2", () => {
    const result = formatNetworkIdentifier({
      namespace: "svm",
      reference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    });
    expect(result).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  });

  it("formats Stellar to CAIP-2", () => {
    const result = formatNetworkIdentifier({
      namespace: "stellar",
      reference: "pubnet",
    });
    expect(result).toBe("stellar:pubnet");
  });
});
