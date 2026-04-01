import { describe, expect, it } from "vitest";
import { Method } from "mppx";
import { Methods as TempoMethods } from "mppx/tempo";
import { Methods as StripeMethods } from "mppx/stripe";

describe("mppx Method (learning tests)", () => {
  it("from() creates a method definition with name, intent, and schemas", () => {
    const method = Method.from({
      name: "test-method",
      intent: "charge",
      schema: {
        credential: {
          payload: { _zod: { type: "string" } } as never,
        },
        request: { _zod: { type: "string" } } as never,
      },
    });

    expect(method.name).toBe("test-method");
    expect(method.intent).toBe("charge");
    expect(method.schema).toBeDefined();
    expect(method.schema.credential).toBeDefined();
    expect(method.schema.request).toBeDefined();
  });

  it("toClient() wraps a method with createCredential callback", () => {
    const client = Method.toClient(TempoMethods.charge, {
      async createCredential({ challenge }) {
        return `Payment mock-credential-for-${challenge.id}`;
      },
    });

    expect(client.name).toBe("tempo");
    expect(client.intent).toBe("charge");
    expect(typeof client.createCredential).toBe("function");
  });

  it("TempoMethods.charge has name='tempo' and intent='charge'", () => {
    expect(TempoMethods.charge.name).toBe("tempo");
    expect(TempoMethods.charge.intent).toBe("charge");
    expect(TempoMethods.charge.schema).toBeDefined();
    expect(TempoMethods.charge.schema.request).toBeDefined();
    expect(TempoMethods.charge.schema.credential).toBeDefined();
  });

  it("TempoMethods.charge request schema validates valid data", () => {
    const validRequest = {
      amount: "1000000",
      currency: "0x20c0000000000000000000000000000000000001",
      decimals: 6,
      recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
    };

    const result = TempoMethods.charge.schema.request.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("TempoMethods.session has name='tempo' and intent='session'", () => {
    expect(TempoMethods.session.name).toBe("tempo");
    expect(TempoMethods.session.intent).toBe("session");
    expect(TempoMethods.session.schema).toBeDefined();
    expect(TempoMethods.session.schema.request).toBeDefined();
  });

  it("TempoMethods.session request schema validates valid data", () => {
    const validRequest = {
      amount: "1000",
      currency: "0x20c0000000000000000000000000000000000001",
      decimals: 6,
      unitType: "token",
    };

    const result = TempoMethods.session.schema.request.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("StripeMethods.charge has name='stripe' and intent='charge'", () => {
    expect(StripeMethods.charge.name).toBe("stripe");
    expect(StripeMethods.charge.intent).toBe("charge");
    expect(StripeMethods.charge.schema).toBeDefined();
  });

  it("StripeMethods.charge request schema validates valid data", () => {
    const validRequest = {
      amount: "500",
      currency: "usd",
      decimals: 2,
      networkId: "acct_abc123",
      paymentMethodTypes: ["card"],
    };

    const result = StripeMethods.charge.schema.request.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("tempo charge request schema rejects missing required fields", () => {
    const invalidRequest = {
      amount: "1000",
    };

    const result = TempoMethods.charge.schema.request.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it("stripe charge request schema rejects missing required fields", () => {
    const invalidRequest = {
      amount: "500",
      currency: "usd",
    };

    const result = StripeMethods.charge.schema.request.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it("method names match expected string values (regression guard)", () => {
    expect(TempoMethods.charge.name).toBe("tempo");
    expect(TempoMethods.session.name).toBe("tempo");
    expect(StripeMethods.charge.name).toBe("stripe");
  });

  it("method intents match expected string values (regression guard)", () => {
    expect(TempoMethods.charge.intent).toBe("charge");
    expect(TempoMethods.session.intent).toBe("session");
    expect(StripeMethods.charge.intent).toBe("charge");
  });
});
