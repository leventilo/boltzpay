import { describe, expect, it } from "vitest";
import {
  decodeBolt11AmountWith,
  isL402Challenge,
  parseL402Challenge,
} from "../../src/l402/l402-types";

describe("parseL402Challenge — standard format", () => {
  it("should parse valid L402 header", () => {
    const header = 'L402 macaroon="abc123base64", invoice="lnbc200n1..."';
    const result = parseL402Challenge(header);
    expect(result.kind).toBe("standard");
    expect(result.kind === "standard" && result.macaroon).toBe("abc123base64");
    expect(result.invoice).toBe("lnbc200n1...");
  });

  it("should be case-insensitive for L402 prefix", () => {
    const header = 'l402 macaroon="mac123", invoice="lnbc100..."';
    const result = parseL402Challenge(header);
    expect(result.kind).toBe("standard");
    expect(result.kind === "standard" && result.macaroon).toBe("mac123");
    expect(result.invoice).toBe("lnbc100...");
  });

  it("should throw on missing both macaroon and payment_hash", () => {
    const header = 'L402 invoice="lnbc100..."';
    expect(() => parseL402Challenge(header)).toThrow(
      "Invalid L402 WWW-Authenticate header",
    );
  });

  it("should throw on missing invoice", () => {
    const header = 'L402 macaroon="abc123"';
    expect(() => parseL402Challenge(header)).toThrow(
      "Invalid L402 WWW-Authenticate header",
    );
  });

  it("should throw on empty string", () => {
    expect(() => parseL402Challenge("")).toThrow(
      "Invalid L402 WWW-Authenticate header",
    );
  });

  it("should throw on non-L402 header", () => {
    expect(() => parseL402Challenge("Bearer token123")).toThrow(
      "Invalid L402 WWW-Authenticate header",
    );
  });

  it("should handle macaroon with valid base64 characters", () => {
    const header =
      'L402 macaroon="AgEMbG9jYXRpb24gaWQ+", invoice="lnbc500n1pj..."';
    const result = parseL402Challenge(header);
    expect(result.kind).toBe("standard");
    expect(result.kind === "standard" && result.macaroon).toBe("AgEMbG9jYXRpb24gaWQ+");
  });

  it("should reject macaroon with invalid base64 characters", () => {
    const header = 'L402 macaroon="invalid{macaroon}", invoice="lnbc..."';
    expect(() => parseL402Challenge(header)).toThrow("Invalid L402 macaroon");
  });

  it("should accept macaroon with padding", () => {
    const header =
      'L402 macaroon="YWJjZA==", invoice="lnbc100n1pj..."';
    const result = parseL402Challenge(header);
    expect(result.kind).toBe("standard");
    expect(result.kind === "standard" && result.macaroon).toBe("YWJjZA==");
  });

  it("should accept base64url macaroon with - and _ chars", () => {
    const header =
      'L402 macaroon="MDAxYmxvY2F0aW9uIGh5cGVyZG9wZS5jb20K-XB0dJPeXFCg", invoice="lnbc100n1..."';
    const result = parseL402Challenge(header);
    expect(result.kind === "standard" && result.macaroon).toBe(
      "MDAxYmxvY2F0aW9uIGh5cGVyZG9wZS5jb20K-XB0dJPeXFCg",
    );
  });

  it("should parse LSAT prefix (legacy name for L402)", () => {
    const header = 'LSAT macaroon="abc123base64", invoice="lnbc200n1..."';
    const result = parseL402Challenge(header);
    expect(result.kind).toBe("standard");
    expect(result.kind === "standard" && result.macaroon).toBe("abc123base64");
    expect(result.invoice).toBe("lnbc200n1...");
    expect(result.prefix).toBe("LSAT");
  });

  it("should return L402 prefix for L402 header", () => {
    const header = 'L402 macaroon="abc123", invoice="lnbc100..."';
    const result = parseL402Challenge(header);
    expect(result.prefix).toBe("L402");
  });

  it("should parse lowercase lsat prefix", () => {
    const header = 'lsat macaroon="mac123", invoice="lnbc100..."';
    const result = parseL402Challenge(header);
    expect(result.prefix).toBe("LSAT");
  });

  it("should handle extra whitespace between fields", () => {
    const header = 'L402 macaroon="abc123"  ,  invoice="lnbc100..."';
    const result = parseL402Challenge(header);
    expect(result.kind === "standard" && result.macaroon).toBe("abc123");
    expect(result.invoice).toBe("lnbc100...");
  });

  it("should throw on completely garbage input", () => {
    expect(() => parseL402Challenge("not a valid header at all")).toThrow(
      "Invalid L402 WWW-Authenticate header",
    );
  });

  it("should throw on macaroon containing shell injection chars", () => {
    const header = 'L402 macaroon="$(rm -rf /)", invoice="lnbc100..."';
    expect(() => parseL402Challenge(header)).toThrow("Invalid L402 macaroon");
  });
});

describe("parseL402Challenge — invoice-only format (MaxSats)", () => {
  const VALID_HASH = "ced2697166bcb30f9cedc4fadd456144e279348cbc3ec61f839d4ea6bb0e493d";

  it("should parse invoice-only L402 header", () => {
    const header = `L402 invoice="lnbc50n1pj_test", payment_hash="${VALID_HASH}"`;
    const result = parseL402Challenge(header);
    expect(result.kind).toBe("invoice-only");
    expect(result.invoice).toBe("lnbc50n1pj_test");
    if (result.kind === "invoice-only") {
      expect(result.paymentHash).toBe(VALID_HASH);
    }
  });

  it("should be case-insensitive for prefix", () => {
    const header = `l402 invoice="lnbc50n1pj_test", payment_hash="${VALID_HASH}"`;
    const result = parseL402Challenge(header);
    expect(result.kind).toBe("invoice-only");
    expect(result.prefix).toBe("L402");
  });

  it("should support LSAT prefix on invoice-only format", () => {
    const header = `LSAT invoice="lnbc50n1pj_test", payment_hash="${VALID_HASH}"`;
    const result = parseL402Challenge(header);
    expect(result.kind).toBe("invoice-only");
    expect(result.prefix).toBe("LSAT");
  });

  it("should reject payment_hash that is not 64 hex chars", () => {
    const header = 'L402 invoice="lnbc50n1...", payment_hash="tooshort"';
    expect(() => parseL402Challenge(header)).toThrow(
      "Invalid L402 payment_hash",
    );
  });

  it("should reject payment_hash with non-hex characters", () => {
    const badHash = "zzz2697166bcb30f9cedc4fadd456144e279348cbc3ec61f839d4ea6bb0e493d";
    const header = `L402 invoice="lnbc50n1...", payment_hash="${badHash}"`;
    expect(() => parseL402Challenge(header)).toThrow(
      "Invalid L402 payment_hash",
    );
  });

  it("should accept uppercase hex in payment_hash", () => {
    const upperHash = "CED2697166BCB30F9CEDC4FADD456144E279348CBC3EC61F839D4EA6BB0E493D";
    const header = `L402 invoice="lnbc50n1...", payment_hash="${upperHash}"`;
    const result = parseL402Challenge(header);
    expect(result.kind).toBe("invoice-only");
  });

  it("should prefer standard format when both could match", () => {
    // Standard format has macaroon — it wins over invoice-only
    const header = 'L402 macaroon="abc123", invoice="lnbc200n1..."';
    const result = parseL402Challenge(header);
    expect(result.kind).toBe("standard");
  });

  it("should throw if only invoice present (no macaroon, no payment_hash)", () => {
    const header = 'L402 invoice="lnbc50n1..."';
    expect(() => parseL402Challenge(header)).toThrow(
      "Invalid L402 WWW-Authenticate header",
    );
  });
});

describe("isL402Challenge", () => {
  it("should return true for valid standard L402 header", () => {
    expect(
      isL402Challenge('L402 macaroon="abc", invoice="lnbc..."'),
    ).toBe(true);
  });

  it("should return true for invoice-only L402 header", () => {
    const hash = "ced2697166bcb30f9cedc4fadd456144e279348cbc3ec61f839d4ea6bb0e493d";
    expect(
      isL402Challenge(`L402 invoice="lnbc50n1...", payment_hash="${hash}"`),
    ).toBe(true);
  });

  it("should return false for Bearer header", () => {
    expect(isL402Challenge("Bearer token123")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isL402Challenge("")).toBe(false);
  });

  it("should return true for lowercase l402", () => {
    expect(
      isL402Challenge('l402 macaroon="abc", invoice="lnbc..."'),
    ).toBe(true);
  });

  it("should return true for LSAT prefix", () => {
    expect(
      isL402Challenge('LSAT macaroon="abc", invoice="lnbc..."'),
    ).toBe(true);
  });

  it("should return true for lowercase lsat prefix", () => {
    expect(
      isL402Challenge('lsat macaroon="abc", invoice="lnbc..."'),
    ).toBe(true);
  });

  it("should return true for LSAT invoice-only", () => {
    const hash = "ced2697166bcb30f9cedc4fadd456144e279348cbc3ec61f839d4ea6bb0e493d";
    expect(
      isL402Challenge(`LSAT invoice="lnbc50n1...", payment_hash="${hash}"`),
    ).toBe(true);
  });
});

describe("decodeBolt11AmountWith", () => {
  function mockDecode(msats: string) {
    return (_invoice: string) => ({
      sections: [
        { name: "lightning_network", value: "bc" },
        { name: "amount", value: msats },
        { name: "timestamp", value: "1234567890" },
      ],
    });
  }

  it("should decode 200000 msats to 200 sats", () => {
    const sats = decodeBolt11AmountWith(mockDecode("200000"), "lnbc...");
    expect(sats).toBe(200n);
  });

  it("should decode 1000 msats to 1 sat", () => {
    const sats = decodeBolt11AmountWith(mockDecode("1000"), "lnbc...");
    expect(sats).toBe(1n);
  });

  it("should round up fractional msats (1500 msats = 2 sats)", () => {
    const sats = decodeBolt11AmountWith(mockDecode("1500"), "lnbc...");
    expect(sats).toBe(2n);
  });

  it("should round up 1 msat to 1 sat", () => {
    const sats = decodeBolt11AmountWith(mockDecode("1"), "lnbc...");
    expect(sats).toBe(1n);
  });

  it("should throw on invoice without amount section", () => {
    const noAmount = () => ({
      sections: [{ name: "timestamp", value: "1234" }],
    });
    expect(() => decodeBolt11AmountWith(noAmount, "lnbc...")).toThrow(
      "BOLT11 invoice has no amount field",
    );
  });

  it("should throw on zero amount", () => {
    expect(() => decodeBolt11AmountWith(mockDecode("0"), "lnbc...")).toThrow(
      "BOLT11 invoice amount must be positive",
    );
  });

  it("should throw on negative amount", () => {
    expect(() => decodeBolt11AmountWith(mockDecode("-1000"), "lnbc...")).toThrow(
      "BOLT11 invoice amount must be positive",
    );
  });

  it("should throw on non-string amount value", () => {
    const numericDecode = (_invoice: string) => ({
      sections: [
        { name: "amount", value: 200000 },
      ],
    });
    expect(() => decodeBolt11AmountWith(numericDecode, "lnbc...")).toThrow(
      "BOLT11 amount must be a string",
    );
  });

  it("should handle large invoice amounts", () => {
    // 1 BTC = 100_000_000 sats = 100_000_000_000 msats
    const sats = decodeBolt11AmountWith(
      mockDecode("100000000000"),
      "lnbc...",
    );
    expect(sats).toBe(100_000_000n);
  });
});
