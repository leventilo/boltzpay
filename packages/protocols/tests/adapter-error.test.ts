import { describe, expect, it } from "vitest";
import {
  AdapterError,
  CdpProvisioningError,
  L402CredentialsMissingError,
  L402PaymentError,
  L402QuoteError,
  X402PaymentError,
  X402QuoteError,
} from "../src/adapter-error";

describe("AdapterError subclasses", () => {
  it('X402PaymentError should have code "x402_payment_failed"', () => {
    const error = new X402PaymentError("payment failed");
    expect(error.code).toBe("x402_payment_failed");
  });

  it('X402QuoteError should have code "x402_quote_failed"', () => {
    const error = new X402QuoteError("quote failed");
    expect(error.code).toBe("x402_quote_failed");
  });

  it('CdpProvisioningError should have code "cdp_provisioning_failed"', () => {
    const error = new CdpProvisioningError("provisioning failed");
    expect(error.code).toBe("cdp_provisioning_failed");
  });

  it('L402QuoteError should have code "l402_quote_failed"', () => {
    const error = new L402QuoteError("quote failed");
    expect(error.code).toBe("l402_quote_failed");
  });

  it('L402PaymentError should have code "l402_payment_failed"', () => {
    const error = new L402PaymentError("payment failed");
    expect(error.code).toBe("l402_payment_failed");
  });

  it('L402CredentialsMissingError should have code "l402_credentials_missing"', () => {
    const error = new L402CredentialsMissingError();
    expect(error.code).toBe("l402_credentials_missing");
  });

  it("should preserve cause via ErrorOptions", () => {
    const originalError = new Error("lightning broke");
    const error = new L402PaymentError("payment failed", {
      cause: originalError,
    });
    expect(error.cause).toBe(originalError);
  });

  it("All subclasses should be instanceof AdapterError", () => {
    const errors: AdapterError[] = [
      new X402PaymentError("test"),
      new X402QuoteError("test"),
      new CdpProvisioningError("test"),
      new L402QuoteError("test"),
      new L402PaymentError("test"),
      new L402CredentialsMissingError(),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("All subclasses should set name to constructor name", () => {
    const errors: AdapterError[] = [
      new X402PaymentError("test"),
      new X402QuoteError("test"),
      new CdpProvisioningError("test"),
      new L402QuoteError("test"),
      new L402PaymentError("test"),
      new L402CredentialsMissingError(),
    ];

    for (const error of errors) {
      expect(error.name).toBe(error.constructor.name);
    }
  });
});
