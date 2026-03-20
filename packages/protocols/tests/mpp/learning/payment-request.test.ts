import { describe, expect, it } from "vitest";
import { PaymentRequest } from "mppx";
import { Methods as TempoMethods } from "mppx/tempo";
import { Methods as StripeMethods } from "mppx/stripe";

describe("mppx PaymentRequest (learning tests)", () => {
  it("from() creates request with arbitrary fields", () => {
    const request = PaymentRequest.from({
      amount: "1000000",
      currency: "0x20c0000000000000000000000000000000000001",
      recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
    });

    expect(request.amount).toBe("1000000");
    expect(request.currency).toBe("0x20c0000000000000000000000000000000000001");
    expect(request.recipient).toBe("0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00");
  });

  it("fromMethod() validates and transforms tempo charge request (amount * 10^decimals)", () => {
    // mppx fromMethod() applies a Zod transform pipeline that scales
    // the amount by 10^decimals to produce atomic units
    const request = PaymentRequest.fromMethod(TempoMethods.charge, {
      amount: "1000000",
      currency: "0x20c0000000000000000000000000000000000001",
      decimals: 6,
      recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
    });

    // amount is scaled: "1000000" * 10^6 = "1000000000000"
    expect(request.amount).toBe("1000000000000");
    expect(request.currency).toBe("0x20c0000000000000000000000000000000000001");
  });

  it("fromMethod() validates and transforms stripe charge request (amount * 10^decimals)", () => {
    // Stripe: "500" with decimals 2 => "50000" (500 * 100)
    const request = PaymentRequest.fromMethod(StripeMethods.charge, {
      amount: "500",
      currency: "usd",
      decimals: 2,
      networkId: "acct_abc123",
      paymentMethodTypes: ["card"],
    });

    expect(request.amount).toBe("50000");
    expect(request.currency).toBe("usd");
  });

  it("serialize() encodes to base64url string", () => {
    const request = PaymentRequest.from({
      amount: "1000",
      currency: "usd",
    });

    const serialized = PaymentRequest.serialize(request);

    expect(typeof serialized).toBe("string");
    expect(serialized.length).toBeGreaterThan(0);
  });

  it("deserialize() decodes from base64url and restores fields", () => {
    const serialized = PaymentRequest.serialize(
      PaymentRequest.from({
        amount: "2500",
        currency: "usd",
        recipient: "acct_test",
      }),
    );

    const deserialized = PaymentRequest.deserialize(serialized);

    expect(deserialized.amount).toBe("2500");
    expect(deserialized.currency).toBe("usd");
    expect(deserialized.recipient).toBe("acct_test");
  });

  it("round-trip: serialize -> deserialize produces identical request", () => {
    const original = PaymentRequest.from({
      amount: "999",
      currency: "eur",
      description: "test payment",
    });

    const roundTripped = PaymentRequest.deserialize(
      PaymentRequest.serialize(original),
    );

    expect(roundTripped).toEqual(original);
  });

  it("fromMethod() rejects invalid tempo charge request (missing decimals)", () => {
    expect(() =>
      PaymentRequest.fromMethod(TempoMethods.charge, {
        amount: "1000",
        currency: "0x20c",
      } as never),
    ).toThrow();
  });

  it("fromMethod() rejects invalid stripe charge request (missing networkId)", () => {
    expect(() =>
      PaymentRequest.fromMethod(StripeMethods.charge, {
        amount: "500",
        currency: "usd",
        decimals: 2,
        paymentMethodTypes: ["card"],
      } as never),
    ).toThrow();
  });
});
