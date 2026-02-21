/** Base class for all domain-level errors. Provides a stable machine-readable `code`. */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Thrown when a Money operation would produce a negative amount. Code: `money_negative`. */
export class NegativeMoneyError extends DomainError {
  readonly code = "money_negative";
  constructor() {
    super("Money cannot be negative");
  }
}

/** Thrown when a string cannot be parsed as a dollar amount. Code: `money_invalid_format`. */
export class InvalidMoneyFormatError extends DomainError {
  readonly code = "money_invalid_format";
  constructor(input: string) {
    super(
      `Invalid money format: "${input}". Expected a numeric string like "10.50" or "$10.50" with at most 2 decimal places`,
    );
  }
}

/** Thrown when performing arithmetic on Money with different currencies. Code: `currency_mismatch`. */
export class CurrencyMismatchError extends DomainError {
  readonly code = "currency_mismatch";
  constructor() {
    super("Cannot perform operations on Money with different currencies");
  }
}
