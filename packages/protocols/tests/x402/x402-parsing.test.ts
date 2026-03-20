import { describe, expect, it } from "vitest";
import { X402QuoteError } from "../../src/adapter-error";
import {
  safeBase64Decode,
  normalizeV1Accept,
  parseV1Body,
  parseWwwAuthenticate,
  usdcDisplayToAtomic,
  extractMetadata,
  isPaymentRequiredShape,
  decodePaymentRequired,
} from "../../src/x402/x402-parsing-helpers";

describe("safeBase64Decode", () => {
  it("should decode valid base64", () => {
    const encoded = btoa('{"hello":"world"}');
    expect(safeBase64Decode(encoded)).toBe('{"hello":"world"}');
  });

  it("should throw X402QuoteError on invalid base64", () => {
    expect(() => safeBase64Decode("!!!invalid!!!")).toThrow(X402QuoteError);
    expect(() => safeBase64Decode("!!!invalid!!!")).toThrow(
      "Invalid base64 in payment header",
    );
  });
});

describe("normalizeV1Accept", () => {
  it("should handle maxAmountRequired -> amount normalization", () => {
    const result = normalizeV1Accept({
      maxAmountRequired: "10000",
      network: "eip155:8453",
      payTo: "0xabc",
      asset: "USDC",
    });
    expect(result).toEqual({
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: "USDC",
      payTo: "0xabc",
    });
  });

  it("should use amount when maxAmountRequired is absent", () => {
    const result = normalizeV1Accept({
      amount: "5000",
      network: "eip155:8453",
      payTo: "0xdef",
      asset: "USDC",
      scheme: "exact",
    });
    expect(result).toEqual({
      scheme: "exact",
      network: "eip155:8453",
      amount: "5000",
      asset: "USDC",
      payTo: "0xdef",
    });
  });

  it("should return null for invalid input (missing required fields)", () => {
    expect(normalizeV1Accept(null)).toBeNull();
    expect(normalizeV1Accept(undefined)).toBeNull();
    expect(normalizeV1Accept(42)).toBeNull();
    expect(normalizeV1Accept({ network: "eip155:8453" })).toBeNull(); // missing amount + payTo
    expect(normalizeV1Accept({ amount: "100", network: "eip155:8453" })).toBeNull(); // missing payTo
  });

  it("should default scheme to 'exact' when missing", () => {
    const result = normalizeV1Accept({
      amount: "5000",
      network: "eip155:8453",
      payTo: "0xdef",
      asset: "USDC",
    });
    expect(result?.scheme).toBe("exact");
  });
});

describe("parseV1Body", () => {
  it("should parse valid V1 body with accepts array", () => {
    const body = {
      x402Version: 1,
      accepts: [
        {
          maxAmountRequired: "10000",
          network: "eip155:8453",
          payTo: "0xabc",
          asset: "USDC",
        },
      ],
    };
    const result = parseV1Body(body);
    expect(result).not.toBeNull();
    expect(result?.x402Version).toBe(1);
    expect(result?.accepts).toHaveLength(1);
    expect(result?.accepts[0]?.amount).toBe("10000");
    expect(result?.accepts[0]?.scheme).toBe("exact");
  });

  it("should return null for null/undefined/non-object", () => {
    expect(parseV1Body(null)).toBeNull();
    expect(parseV1Body(undefined)).toBeNull();
    expect(parseV1Body("string")).toBeNull();
  });

  it("should return null for invalid x402Version", () => {
    expect(parseV1Body({ x402Version: 0, accepts: [{}] })).toBeNull();
    expect(parseV1Body({ x402Version: -1, accepts: [{}] })).toBeNull();
    expect(parseV1Body({ accepts: [{}] })).toBeNull();
  });

  it("should return null when accepts array is empty", () => {
    expect(parseV1Body({ x402Version: 1, accepts: [] })).toBeNull();
  });

  it("should return null when all accepts fail normalization", () => {
    expect(
      parseV1Body({
        x402Version: 1,
        accepts: [{ invalid: true }],
      }),
    ).toBeNull();
  });
});

describe("parseWwwAuthenticate", () => {
  it("should extract address, amount (display to atomic), chainId", () => {
    const header = 'x402 address="0xabc", amount="0.01", chainId="8453"';
    const result = parseWwwAuthenticate(header);
    expect(result).not.toBeNull();
    expect(result?.accepts[0]?.payTo).toBe("0xabc");
    expect(result?.accepts[0]?.amount).toBe("10000"); // 0.01 USDC = 10000 atomic
    expect(result?.accepts[0]?.network).toBe("eip155:8453");
    expect(result?.x402Version).toBe(2);
  });

  it("should return null when address or amount missing", () => {
    expect(parseWwwAuthenticate('x402 address="0xabc"')).toBeNull();
    expect(parseWwwAuthenticate('x402 amount="0.01"')).toBeNull();
    expect(parseWwwAuthenticate("Bearer realm=test")).toBeNull();
  });

  it("should use default network when chainId missing", () => {
    const header = 'x402 address="0xabc", amount="1.00"';
    const result = parseWwwAuthenticate(header);
    expect(result?.accepts[0]?.network).toBe("eip155:8453");
  });

  it("should tolerate spaces around = in params", () => {
    const header = 'x402 address = "0xabc", amount = "0.01", chainId = "8453"';
    const result = parseWwwAuthenticate(header);
    expect(result).not.toBeNull();
    expect(result?.accepts[0]?.payTo).toBe("0xabc");
    expect(result?.accepts[0]?.amount).toBe("10000");
  });

  it("should tolerate unquoted param values", () => {
    const header = "x402 address=0xabc, amount=0.01";
    const result = parseWwwAuthenticate(header);
    expect(result).not.toBeNull();
    expect(result?.accepts[0]?.payTo).toBe("0xabc");
  });

  it("should handle case-insensitive param names", () => {
    const header = 'x402 Address="0xabc", Amount="0.05", ChainId="1"';
    const result = parseWwwAuthenticate(header);
    expect(result).not.toBeNull();
    expect(result?.accepts[0]?.payTo).toBe("0xabc");
    expect(result?.accepts[0]?.network).toBe("eip155:1");
  });
});

describe("usdcDisplayToAtomic", () => {
  it('should convert "0.01" to "10000"', () => {
    expect(usdcDisplayToAtomic("0.01")).toBe("10000");
  });

  it('should convert "1.00" to "1000000"', () => {
    expect(usdcDisplayToAtomic("1.00")).toBe("1000000");
  });

  it("should return null for negative amounts", () => {
    expect(usdcDisplayToAtomic("-1.00")).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(usdcDisplayToAtomic("")).toBeNull();
  });

  it("should return null for too-long amounts", () => {
    expect(usdcDisplayToAtomic("1".repeat(50))).toBeNull();
  });

  it("should handle whole numbers without decimals", () => {
    expect(usdcDisplayToAtomic("5")).toBe("5000000");
  });

  it("should handle more than 6 decimal places by truncating", () => {
    expect(usdcDisplayToAtomic("1.1234567")).toBe("1123456");
  });
});

describe("extractMetadata", () => {
  it("should combine resource + bazaar info", () => {
    const parsed = {
      resource: {
        url: "https://example.com/api",
        description: "Test API",
      },
      extensions: {
        bazaar: {
          info: {
            input: { type: "json", method: "POST" },
            output: { type: "text" },
          },
        },
      },
    };
    const result = extractMetadata(parsed as Record<string, unknown>);
    expect(result).not.toBeNull();
    expect(result?.resource?.url).toBe("https://example.com/api");
    expect(result?.bazaarInput?.type).toBe("json");
    expect(result?.bazaarOutput?.type).toBe("text");
  });

  it("should return undefined when no metadata present", () => {
    expect(extractMetadata({} as Record<string, unknown>)).toBeUndefined();
  });
});

describe("isPaymentRequiredShape", () => {
  it("should validate minimal shape", () => {
    expect(
      isPaymentRequiredShape({ x402Version: 2, accepts: [] }),
    ).toBe(true);
  });

  it("should reject non-objects", () => {
    expect(isPaymentRequiredShape(null)).toBe(false);
    expect(isPaymentRequiredShape(undefined)).toBe(false);
    expect(isPaymentRequiredShape("string")).toBe(false);
  });

  it("should reject missing x402Version", () => {
    expect(isPaymentRequiredShape({ accepts: [] })).toBe(false);
  });

  it("should reject missing accepts", () => {
    expect(isPaymentRequiredShape({ x402Version: 2 })).toBe(false);
  });

  it("should reject non-array accepts", () => {
    expect(
      isPaymentRequiredShape({ x402Version: 2, accepts: "not-array" }),
    ).toBe(false);
  });
});

describe("decodePaymentRequired", () => {
  it("should decode valid base64 header with accepts array", () => {
    const payload = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "100000",
          asset: "0xUSDC",
          payTo: "0xRecipient",
        },
      ],
    };
    const encoded = btoa(JSON.stringify(payload));
    const result = decodePaymentRequired(encoded);
    expect(result.x402Version).toBe(2);
    expect(result.accepts).toHaveLength(1);
    expect(result.accepts[0]?.amount).toBe("100000");
  });

  it("should throw on invalid base64", () => {
    expect(() => decodePaymentRequired("!!!")).toThrow(X402QuoteError);
  });

  it("should throw on invalid structure (missing accepts)", () => {
    const encoded = btoa(JSON.stringify({ x402Version: 2 }));
    expect(() => decodePaymentRequired(encoded)).toThrow(X402QuoteError);
  });

  it("should throw on invalid accept entry", () => {
    const encoded = btoa(
      JSON.stringify({
        x402Version: 2,
        accepts: [{ invalid: true }],
      }),
    );
    expect(() => decodePaymentRequired(encoded)).toThrow(X402QuoteError);
  });

  it("should extract metadata when present", () => {
    const payload = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "100000",
          asset: "0xUSDC",
          payTo: "0xRecipient",
        },
      ],
      resource: { url: "https://example.com" },
    };
    const encoded = btoa(JSON.stringify(payload));
    const result = decodePaymentRequired(encoded);
    expect(result.metadata?.resource?.url).toBe("https://example.com");
  });
});
