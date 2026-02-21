import {
  CurrencyMismatchError,
  InvalidMoneyFormatError,
  NegativeMoneyError,
} from "./domain-error";

const USD = "USD" as const;
const SATS = "SATS" as const;

/** Supported currency codes: USD (fiat cents) or SATS (Bitcoin satoshis). */
type Currency = typeof USD | typeof SATS;

const DOLLARS_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Immutable Value Object representing a monetary amount.
 * Supports USD (cents) and SATS (Bitcoin satoshis).
 * All arithmetic is bigint-based — no floating-point precision loss.
 *
 * @example
 * ```ts
 * const price = Money.fromDollars("10.50");
 * const total = price.add(Money.fromCents(200n)); // $12.50
 * const sats = Money.fromSatoshis(200n); // 200 sats
 * ```
 */
export class Money {
  /** Amount in atomic units: cents for USD, satoshis for SATS. */
  readonly cents: bigint;
  /** Currency code: "USD" or "SATS". */
  readonly currency: Currency;

  private constructor(cents: bigint, currency: Currency) {
    if (cents < 0n) {
      throw new NegativeMoneyError();
    }
    this.cents = cents;
    this.currency = currency;
  }

  /** Create Money from a bigint cent value (USD). @throws NegativeMoneyError if cents < 0. */
  static fromCents(cents: bigint): Money {
    return new Money(cents, USD);
  }

  /** Create Money from a bigint satoshi value (Bitcoin Lightning). @throws NegativeMoneyError if sats < 0. */
  static fromSatoshis(sats: bigint): Money {
    return new Money(sats, SATS);
  }

  /**
   * Create Money from a dollar string (e.g. "10.50", "$10.50").
   * @throws InvalidMoneyFormatError if the string is not a valid dollar amount.
   */
  static fromDollars(dollars: string): Money {
    if (typeof dollars !== "string") {
      throw new InvalidMoneyFormatError(String(dollars));
    }

    const cleaned = dollars.replace("$", "").trim();

    if (
      cleaned === "" ||
      cleaned === "NaN" ||
      cleaned === "Infinity" ||
      cleaned === "-Infinity"
    ) {
      throw new InvalidMoneyFormatError(dollars);
    }

    if (!DOLLARS_PATTERN.test(cleaned)) {
      throw new InvalidMoneyFormatError(dollars);
    }

    const parts = cleaned.split(".");
    const wholePart = parts[0] ?? "0";
    const fracPart = (parts[1] ?? "00").padEnd(2, "0");
    const cents = BigInt(wholePart) * 100n + BigInt(fracPart);
    return new Money(cents, USD);
  }

  /** Reconstruct a Money instance from its `toJSON()` representation. */
  static fromJSON(json: { cents: string; currency: string }): Money {
    const cents = BigInt(json.cents);
    const currency = json.currency === SATS ? SATS : USD;
    return new Money(cents, currency);
  }

  /** Create a zero-value Money instance. */
  static zero(): Money {
    return new Money(0n, USD);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError();
    }
  }

  /** Add two Money values. @throws CurrencyMismatchError if currencies differ. */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }

  /** Subtract other from this. @throws NegativeMoneyError if result would be negative. */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    if (other.cents > this.cents) {
      throw new NegativeMoneyError();
    }
    return new Money(this.cents - other.cents, this.currency);
  }

  /** Multiply by a bigint factor. @throws NegativeMoneyError if factor < 0. */
  multiply(factor: bigint): Money {
    if (factor < 0n) {
      throw new NegativeMoneyError();
    }
    return new Money(this.cents * factor, this.currency);
  }

  /** True if amount is exactly zero. */
  isZero(): boolean {
    return this.cents === 0n;
  }

  /** True if this amount is strictly greater than other. */
  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents > other.cents;
  }

  /** True if this amount is greater than or equal to other. */
  greaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents >= other.cents;
  }

  /** Value equality — true if both cents and currency match. */
  equals(other: Money): boolean {
    return this.cents === other.cents && this.currency === other.currency;
  }

  /** Format for display: "$10.50" for USD, "200 sats" for SATS. */
  toDisplayString(): string {
    if (this.currency === SATS) {
      return `${this.cents} sats`;
    }
    const str = this.cents.toString();
    if (str.length <= 2) {
      return `$0.${str.padStart(2, "0")}`;
    }
    const dollars = str.slice(0, -2);
    const fracPart = str.slice(-2);
    return `$${dollars}.${fracPart}`;
  }

  /** JSON-safe representation — prevents BigInt serialization crash. */
  toJSON(): { cents: string; currency: Currency; display: string } {
    return {
      cents: this.cents.toString(),
      currency: this.currency,
      display: this.toDisplayString(),
    };
  }
}
