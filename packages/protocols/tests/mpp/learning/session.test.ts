import { describe, expect, it } from "vitest";
import { Challenge, Errors } from "mppx";
import { Methods as TempoMethods } from "mppx/tempo";

describe("mppx Session (learning tests)", () => {
  const REALM = "api.example.com";
  const SECRET = "session-test-secret";
  // channelId requires 0x + 64 hex chars (32 bytes hash)
  const CHANNEL_ID = "0x" + "ab".repeat(32);
  const VALID_SIGNATURE = "0x" + "de".repeat(32);
  const VALID_TX_HASH = "0x" + "cf".repeat(32);

  it("TempoMethods.session schema validates session request fields", () => {
    const validRequest = {
      amount: "5000000",
      currency: "0x20c0000000000000000000000000000000000001",
      decimals: 6,
      unitType: "token",
    };

    const result = TempoMethods.session.schema.request.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("TempoMethods.session schema validates with optional fields", () => {
    const fullRequest = {
      amount: "5000000",
      currency: "0x20c0000000000000000000000000000000000001",
      decimals: 6,
      unitType: "token",
      channelId: CHANNEL_ID,
      escrowContract: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
      minVoucherDelta: "100000",
      suggestedDeposit: "10000000",
      recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
    };

    const result = TempoMethods.session.schema.request.safeParse(fullRequest);
    expect(result.success).toBe(true);
  });

  it("TempoMethods.session schema rejects missing required unitType", () => {
    const invalidRequest = {
      amount: "5000000",
      currency: "0x20c0000000000000000000000000000000000001",
      decimals: 6,
    };

    const result = TempoMethods.session.schema.request.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it("session challenge can be created via Challenge.fromMethod", () => {
    const challenge = Challenge.fromMethod(TempoMethods.session, {
      secretKey: SECRET,
      realm: REALM,
      request: {
        amount: "5000000",
        currency: "0x20c0000000000000000000000000000000000001",
        decimals: 6,
        unitType: "token",
      },
    });

    expect(challenge.method).toBe("tempo");
    expect(challenge.intent).toBe("session");
    expect(challenge.realm).toBe(REALM);
    expect(challenge.id).toBeDefined();
  });

  it("session challenge has intent='session' (not 'charge')", () => {
    const sessionChallenge = Challenge.fromMethod(TempoMethods.session, {
      id: "session-intent-test",
      realm: REALM,
      request: {
        amount: "1000",
        currency: "0x20c0000000000000000000000000000000000001",
        decimals: 6,
        unitType: "token",
      },
    });

    const chargeChallenge = Challenge.fromMethod(TempoMethods.charge, {
      id: "charge-intent-test",
      realm: REALM,
      request: {
        amount: "1000",
        currency: "0x20c0000000000000000000000000000000000001",
        decimals: 6,
      },
    });

    expect(sessionChallenge.intent).toBe("session");
    expect(chargeChallenge.intent).toBe("charge");
    expect(sessionChallenge.intent).not.toBe(chargeChallenge.intent);
  });

  it("session-specific error types are importable and instantiable", () => {
    const insufficientBalance = new Errors.InsufficientBalanceError({ reason: "empty" });
    const channelNotFound = new Errors.ChannelNotFoundError({ reason: "no channel" });
    const channelClosed = new Errors.ChannelClosedError({ reason: "finalized" });
    const signerMismatch = new Errors.SignerMismatchError({ reason: "wrong key" });
    const amountExceeds = new Errors.AmountExceedsDepositError({ reason: "over deposit" });
    const deltaTooSmall = new Errors.DeltaTooSmallError({ reason: "min not met" });

    expect(insufficientBalance).toBeInstanceOf(Errors.PaymentError);
    expect(channelNotFound).toBeInstanceOf(Errors.PaymentError);
    expect(channelClosed).toBeInstanceOf(Errors.PaymentError);
    expect(signerMismatch).toBeInstanceOf(Errors.PaymentError);
    expect(amountExceeds).toBeInstanceOf(Errors.PaymentError);
    expect(deltaTooSmall).toBeInstanceOf(Errors.PaymentError);
  });

  it("session challenge serializes and deserializes correctly", () => {
    const challenge = Challenge.fromMethod(TempoMethods.session, {
      id: "session-serde",
      realm: REALM,
      request: {
        amount: "2000",
        currency: "0x20c0000000000000000000000000000000000001",
        decimals: 6,
        unitType: "token",
      },
    });

    const serialized = Challenge.serialize(challenge);
    const deserialized = Challenge.deserialize(serialized);

    expect(deserialized.method).toBe("tempo");
    expect(deserialized.intent).toBe("session");
    expect(deserialized.id).toBe("session-serde");
  });

  // Session lifecycle documentation:
  // 1. Server issues session challenge (intent="session")
  // 2. Client creates credential with action="open" + deposit transaction
  // 3. Server verifies deposit, opens payment channel
  // 4. Client sends action="topUp" credentials to add funds
  // 5. Client sends action="voucher" credentials (cumulative amounts) for streaming payments
  // 6. Client sends action="close" credential to finalize the channel
  it("session credential payload schema validates open action", () => {
    const openPayload = {
      action: "open",
      channelId: CHANNEL_ID,
      cumulativeAmount: "0",
      signature: VALID_SIGNATURE,
      transaction: VALID_TX_HASH,
      type: "transaction",
    };

    const result = TempoMethods.session.schema.credential.payload.safeParse(openPayload);
    expect(result.success).toBe(true);
  });

  it("session credential payload schema validates voucher action", () => {
    const voucherPayload = {
      action: "voucher",
      channelId: CHANNEL_ID,
      cumulativeAmount: "500000",
      signature: VALID_SIGNATURE,
    };

    const result = TempoMethods.session.schema.credential.payload.safeParse(voucherPayload);
    expect(result.success).toBe(true);
  });

  it("session credential payload schema validates close action", () => {
    const closePayload = {
      action: "close",
      channelId: CHANNEL_ID,
      cumulativeAmount: "1000000",
      signature: VALID_SIGNATURE,
    };

    const result = TempoMethods.session.schema.credential.payload.safeParse(closePayload);
    expect(result.success).toBe(true);
  });
});
