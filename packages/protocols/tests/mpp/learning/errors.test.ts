import { describe, expect, it } from "vitest";
import { Errors } from "mppx";

describe("mppx Errors (learning tests)", () => {
  it("PaymentError is the base abstract error class", () => {
    expect(Errors.PaymentError).toBeDefined();
    expect(Errors.PaymentError.prototype).toBeInstanceOf(Error);
  });

  it("MalformedCredentialError extends PaymentError", () => {
    const error = new Errors.MalformedCredentialError({ reason: "bad base64" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MalformedCredentialError");
    expect(error.status).toBe(402);
    expect(error.message).toContain("bad base64");
  });

  it("InvalidChallengeError extends PaymentError", () => {
    const error = new Errors.InvalidChallengeError({ id: "abc", reason: "expired" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("InvalidChallengeError");
    expect(error.status).toBe(402);
  });

  it("VerificationFailedError extends PaymentError", () => {
    const error = new Errors.VerificationFailedError({ reason: "invalid signature" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("VerificationFailedError");
  });

  it("PaymentActionRequiredError extends PaymentError", () => {
    const error = new Errors.PaymentActionRequiredError({ reason: "requires_action" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("PaymentActionRequiredError");
  });

  it("PaymentExpiredError extends PaymentError", () => {
    const error = new Errors.PaymentExpiredError({ expires: "2026-01-01T00:00:00Z" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("PaymentExpiredError");
  });

  it("PaymentRequiredError extends PaymentError", () => {
    const error = new Errors.PaymentRequiredError({ description: "Premium access" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("PaymentRequiredError");
  });

  it("InvalidPayloadError extends PaymentError", () => {
    const error = new Errors.InvalidPayloadError({ reason: "missing signature" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("InvalidPayloadError");
  });

  it("BadRequestError extends PaymentError with status 400", () => {
    const error = new Errors.BadRequestError({ reason: "malformed request" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("BadRequestError");
    expect(error.status).toBe(400);
  });

  it("PaymentInsufficientError extends PaymentError", () => {
    const error = new Errors.PaymentInsufficientError({ reason: "expected 1000, received 500" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("PaymentInsufficientError");
  });

  it("PaymentMethodUnsupportedError extends PaymentError with status 400", () => {
    const error = new Errors.PaymentMethodUnsupportedError({ method: "bitcoin" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("PaymentMethodUnsupportedError");
    expect(error.status).toBe(400);
  });

  it("InsufficientBalanceError (session) extends PaymentError", () => {
    const error = new Errors.InsufficientBalanceError({ reason: "channel depleted" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("InsufficientBalanceError");
    expect(error.status).toBe(402);
  });

  it("InvalidSignatureError (session) extends PaymentError", () => {
    const error = new Errors.InvalidSignatureError({ reason: "bad sig" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("InvalidSignatureError");
  });

  it("SignerMismatchError (session) extends PaymentError", () => {
    const error = new Errors.SignerMismatchError({ reason: "wrong signer" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("SignerMismatchError");
  });

  it("AmountExceedsDepositError (session) extends PaymentError", () => {
    const error = new Errors.AmountExceedsDepositError({ reason: "over limit" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("AmountExceedsDepositError");
  });

  it("DeltaTooSmallError (session) extends PaymentError", () => {
    const error = new Errors.DeltaTooSmallError({ reason: "min delta not met" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("DeltaTooSmallError");
  });

  it("ChannelNotFoundError (session) extends PaymentError with status 410", () => {
    const error = new Errors.ChannelNotFoundError({ reason: "unknown channel" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("ChannelNotFoundError");
    expect(error.status).toBe(410);
  });

  it("ChannelClosedError (session) extends PaymentError with status 410", () => {
    const error = new Errors.ChannelClosedError({ reason: "finalized" });

    expect(error).toBeInstanceOf(Errors.PaymentError);
    expect(error.name).toBe("ChannelClosedError");
    expect(error.status).toBe(410);
  });

  it("PaymentError.toProblemDetails() produces RFC 9457 format", () => {
    const error = new Errors.MalformedCredentialError({ reason: "bad json" });
    const details = error.toProblemDetails("challenge-123");

    expect(details.type).toBe("https://paymentauth.org/problems/malformed-credential");
    expect(details.title).toBe("Malformed Credential");
    expect(details.status).toBe(402);
    expect(details.detail).toBeDefined();
    expect(details.challengeId).toBe("challenge-123");
  });
});
