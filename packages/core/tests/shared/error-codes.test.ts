import { describe, expect, it } from "vitest";
import {
  CurrencyMismatchError,
  DomainError,
  InvalidMoneyFormatError,
  NegativeMoneyError,
  ProtocolDetectionFailedError,
} from "../../src";

describe("DomainError codes", () => {
  it('NegativeMoneyError should have code "money_negative"', () => {
    const error = new NegativeMoneyError();
    expect(error.code).toBe("money_negative");
  });

  it('InvalidMoneyFormatError should have code "money_invalid_format"', () => {
    const error = new InvalidMoneyFormatError("bad");
    expect(error.code).toBe("money_invalid_format");
  });

  it('CurrencyMismatchError should have code "currency_mismatch"', () => {
    const error = new CurrencyMismatchError();
    expect(error.code).toBe("currency_mismatch");
  });

  it('ProtocolDetectionFailedError should have code "protocol_detection_failed"', () => {
    const error = new ProtocolDetectionFailedError("https://example.com");
    expect(error.code).toBe("protocol_detection_failed");
  });

  it("All DomainError subclasses should set name to constructor name", () => {
    const errors: DomainError[] = [
      new NegativeMoneyError(),
      new InvalidMoneyFormatError("bad"),
      new CurrencyMismatchError(),
      new ProtocolDetectionFailedError("https://example.com"),
    ];

    for (const error of errors) {
      expect(error.name).toBe(error.constructor.name);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(Error);
    }
  });
});
