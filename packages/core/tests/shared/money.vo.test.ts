import { describe, expect, it } from "vitest";
import { InvalidMoneyFormatError, Money, NegativeMoneyError } from "../../src";

describe("Money", () => {
  it("should create from cents", () => {
    const m = Money.fromCents(1000n);
    expect(m.cents).toBe(1000n);
    expect(m.currency).toBe("USD");
  });

  it("should create from dollars string", () => {
    const m = Money.fromDollars("10.50");
    expect(m.cents).toBe(1050n);
  });

  it("should create from dollars with $ prefix", () => {
    const m = Money.fromDollars("$25.00");
    expect(m.cents).toBe(2500n);
  });

  it("should create zero", () => {
    const m = Money.zero();
    expect(m.cents).toBe(0n);
    expect(m.isZero()).toBe(true);
  });

  it("should add two amounts", () => {
    const a = Money.fromCents(500n);
    const b = Money.fromCents(300n);
    expect(a.add(b).cents).toBe(800n);
  });

  it("should subtract amounts", () => {
    const a = Money.fromCents(500n);
    const b = Money.fromCents(200n);
    expect(a.subtract(b).cents).toBe(300n);
  });

  it("should throw on negative subtract", () => {
    const a = Money.fromCents(100n);
    const b = Money.fromCents(200n);
    expect(() => a.subtract(b)).toThrow(NegativeMoneyError);
  });

  it("should throw on negative construction", () => {
    expect(() => Money.fromCents(-1n)).toThrow(NegativeMoneyError);
  });

  it("should multiply", () => {
    const m = Money.fromCents(250n);
    expect(m.multiply(3n).cents).toBe(750n);
  });

  it("should throw NegativeMoneyError when multiplying by negative factor", () => {
    const m = Money.fromCents(250n);
    expect(() => m.multiply(-2n)).toThrow(NegativeMoneyError);
  });

  it("should return zero when multiplying by zero", () => {
    const m = Money.fromCents(250n);
    const result = m.multiply(0n);
    expect(result.cents).toBe(0n);
    expect(result.isZero()).toBe(true);
  });

  it("should compare greaterThan", () => {
    const a = Money.fromCents(500n);
    const b = Money.fromCents(300n);
    expect(a.greaterThan(b)).toBe(true);
    expect(b.greaterThan(a)).toBe(false);
  });

  it("should compare greaterThanOrEqual", () => {
    const a = Money.fromCents(500n);
    const b = Money.fromCents(500n);
    expect(a.greaterThanOrEqual(b)).toBe(true);
  });

  it("should check equals", () => {
    const a = Money.fromCents(100n);
    const b = Money.fromCents(100n);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(Money.fromCents(200n))).toBe(false);
  });

  it("should display string", () => {
    expect(Money.fromCents(1050n).toDisplayString()).toBe("$10.50");
    expect(Money.fromCents(5n).toDisplayString()).toBe("$0.05");
    expect(Money.fromCents(0n).toDisplayString()).toBe("$0.00");
  });

  it("should reject empty string in fromDollars", () => {
    expect(() => Money.fromDollars("")).toThrow(InvalidMoneyFormatError);
  });

  it("should reject non-numeric string in fromDollars", () => {
    expect(() => Money.fromDollars("abc")).toThrow(InvalidMoneyFormatError);
  });

  it("should reject more than 2 decimal places in fromDollars", () => {
    expect(() => Money.fromDollars("10.999")).toThrow(InvalidMoneyFormatError);
  });

  it("should reject negative values in fromDollars", () => {
    expect(() => Money.fromDollars("-5.00")).toThrow(InvalidMoneyFormatError);
  });

  it("should reject scientific notation in fromDollars", () => {
    expect(() => Money.fromDollars("1e18")).toThrow(InvalidMoneyFormatError);
  });

  it("should accept whole number in fromDollars", () => {
    expect(Money.fromDollars("10").cents).toBe(1000n);
  });

  it("should accept single decimal in fromDollars", () => {
    expect(Money.fromDollars("10.5").cents).toBe(1050n);
  });

  it("should accept zero in fromDollars", () => {
    expect(Money.fromDollars("0").cents).toBe(0n);
  });

  // FOUND-07: Money.fromDollars edge case validation
  it("should reject NaN in fromDollars", () => {
    expect(() => Money.fromDollars("NaN")).toThrow(InvalidMoneyFormatError);
  });

  it("should reject Infinity in fromDollars", () => {
    expect(() => Money.fromDollars("Infinity")).toThrow(
      InvalidMoneyFormatError,
    );
  });

  it("should reject -Infinity in fromDollars", () => {
    expect(() => Money.fromDollars("-Infinity")).toThrow(
      InvalidMoneyFormatError,
    );
  });

  it("should reject non-string input in fromDollars", () => {
    const invalidInput: unknown = 42;
    expect(() => Money.fromDollars(invalidInput as string)).toThrow(InvalidMoneyFormatError);
  });

  it("should return Money.zero() equivalent for fromDollars('0.00')", () => {
    const m = Money.fromDollars("0.00");
    expect(m.cents).toBe(0n);
    expect(m.equals(Money.zero())).toBe(true);
  });

  it("should parse fromDollars('100.50') correctly", () => {
    const m = Money.fromDollars("100.50");
    expect(m.cents).toBe(10050n);
  });

  describe("operations edge cases", () => {
    it("should return equivalent value when subtracting zero", () => {
      const m = Money.fromCents(100n);
      const result = m.subtract(Money.zero());
      expect(result.cents).toBe(100n);
      expect(result.equals(m)).toBe(true);
    });

    it("should double when adding self", () => {
      const m = Money.fromCents(100n);
      const result = m.add(m);
      expect(result.cents).toBe(200n);
      expect(m.cents).toBe(100n); // original unchanged
    });
  });

  describe("toJSON (BigInt serialization safety)", () => {
    it("should produce JSON-safe output with no BigInt", () => {
      const m = Money.fromCents(1050n);
      const json = m.toJSON();
      expect(json).toEqual({
        cents: "1050",
        currency: "USD",
        display: "$10.50",
      });
    });

    it("should survive JSON.stringify without throwing", () => {
      const m = Money.fromCents(500n);
      const str = JSON.stringify(m);
      expect(() => JSON.parse(str)).not.toThrow();
      const parsed = JSON.parse(str);
      expect(parsed.cents).toBe("500");
      expect(parsed.display).toBe("$5.00");
    });

    it("should survive JSON.stringify on objects containing Money", () => {
      const quote = {
        amount: Money.fromCents(1n),
        protocol: "x402",
        network: "eip155:8453",
      };
      const str = JSON.stringify(quote);
      const parsed = JSON.parse(str);
      expect(parsed.amount.cents).toBe("1");
      expect(parsed.amount.display).toBe("$0.01");
    });

    it("should handle zero correctly", () => {
      const json = Money.zero().toJSON();
      expect(json.cents).toBe("0");
      expect(json.display).toBe("$0.00");
    });

    it("should handle large amounts", () => {
      const m = Money.fromCents(9999999n);
      const json = m.toJSON();
      expect(json.cents).toBe("9999999");
      expect(json.display).toBe("$99999.99");
      expect(() => JSON.stringify(m)).not.toThrow();
    });
  });

  it("should parse leading zeros in fromDollars", () => {
    expect(Money.fromDollars("007.50").cents).toBe(750n);
  });

  describe("fromSatoshis", () => {
    it("should create SATS currency", () => {
      const m = Money.fromSatoshis(200n);
      expect(m.cents).toBe(200n);
      expect(m.currency).toBe("SATS");
    });

    it("should display as sats", () => {
      expect(Money.fromSatoshis(200n).toDisplayString()).toBe("200 sats");
      expect(Money.fromSatoshis(1n).toDisplayString()).toBe("1 sats");
      expect(Money.fromSatoshis(0n).toDisplayString()).toBe("0 sats");
    });

    it("should throw on negative sats", () => {
      expect(() => Money.fromSatoshis(-1n)).toThrow(NegativeMoneyError);
    });

    it("should produce correct toJSON", () => {
      const json = Money.fromSatoshis(500n).toJSON();
      expect(json).toEqual({
        cents: "500",
        currency: "SATS",
        display: "500 sats",
      });
    });

    it("should add two SATS amounts", () => {
      const a = Money.fromSatoshis(100n);
      const b = Money.fromSatoshis(200n);
      expect(a.add(b).cents).toBe(300n);
      expect(a.add(b).currency).toBe("SATS");
    });

    it("should throw CurrencyMismatchError on USD + SATS", () => {
      const usd = Money.fromCents(100n);
      const sats = Money.fromSatoshis(100n);
      expect(() => usd.add(sats)).toThrow();
      expect(() => usd.greaterThan(sats)).toThrow();
    });
  });

  describe("immutability", () => {
    it("should not mutate original when adding", () => {
      const original = Money.fromCents(100n);
      const result = original.add(Money.fromCents(50n));
      expect(original.cents).toBe(100n);
      expect(result.cents).toBe(150n);
    });

    it("should not mutate original when subtracting", () => {
      const original = Money.fromCents(100n);
      const result = original.subtract(Money.fromCents(30n));
      expect(original.cents).toBe(100n);
      expect(result.cents).toBe(70n);
    });

    it("should not mutate original when multiplying", () => {
      const original = Money.fromCents(100n);
      const result = original.multiply(3n);
      expect(original.cents).toBe(100n);
      expect(result.cents).toBe(300n);
    });
  });
});
