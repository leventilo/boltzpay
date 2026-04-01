import { describe, expect, it } from "vitest";
import { Challenge, Credential } from "mppx";
import { Methods as TempoMethods } from "mppx/tempo";

describe("mppx Credential (learning tests)", () => {
  const REALM = "api.example.com";
  const SECRET = "test-secret-key";

  const tempoRequest = {
    amount: "1000000",
    currency: "0x20c0000000000000000000000000000000000001",
    decimals: 6,
    recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  };

  function createTestChallenge() {
    return Challenge.from({
      id: "cred-test-challenge",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
    });
  }

  it("from() creates credential from challenge + payload", () => {
    const challenge = createTestChallenge();
    const credential = Credential.from({
      challenge,
      payload: { signature: "0xdeadbeef", type: "transaction" },
    });

    expect(credential.challenge).toBeDefined();
    expect(credential.challenge.id).toBe("cred-test-challenge");
    expect(credential.payload).toEqual({ signature: "0xdeadbeef", type: "transaction" });
  });

  it("from() creates credential with optional source (DID)", () => {
    const challenge = createTestChallenge();
    const credential = Credential.from({
      challenge,
      payload: { signature: "0xdeadbeef", type: "transaction" },
      source: "did:pkh:eip155:42431:0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
    });

    expect(credential.source).toBe(
      "did:pkh:eip155:42431:0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
    );
  });

  it("serialize() produces 'Payment base64url...' Authorization header value", () => {
    const challenge = createTestChallenge();
    const credential = Credential.from({
      challenge,
      payload: { signature: "0xbeef" },
    });

    const header = Credential.serialize(credential);

    expect(typeof header).toBe("string");
    expect(header.startsWith("Payment ")).toBe(true);
    expect(header.length).toBeGreaterThan("Payment ".length);
  });

  it("deserialize() round-trips correctly", () => {
    const challenge = createTestChallenge();
    const original = Credential.from({
      challenge,
      payload: { txHash: "0xabc123" },
    });

    const serialized = Credential.serialize(original);
    const deserialized = Credential.deserialize(serialized);

    expect(deserialized.challenge.id).toBe(original.challenge.id);
    expect(deserialized.challenge.method).toBe("tempo");
    expect(deserialized.payload).toEqual(original.payload);
  });

  it("fromRequest() extracts from Request's Authorization header", () => {
    const challenge = createTestChallenge();
    const credential = Credential.from({
      challenge,
      payload: { txHash: "0x123" },
    });

    const header = Credential.serialize(credential);
    const request = new Request("https://api.example.com/resource", {
      headers: { Authorization: header },
    });

    const extracted = Credential.fromRequest(request);

    expect(extracted.challenge.id).toBe("cred-test-challenge");
    expect(extracted.payload).toEqual({ txHash: "0x123" });
  });

  it("extractPaymentScheme() extracts Payment scheme from header", () => {
    const challenge = createTestChallenge();
    const credential = Credential.from({
      challenge,
      payload: { data: "test" },
    });

    const paymentHeader = Credential.serialize(credential);
    const extracted = Credential.extractPaymentScheme(paymentHeader);

    expect(extracted).toBeDefined();
    expect(extracted).not.toBeNull();
    expect(extracted!.startsWith("Payment ")).toBe(true);
  });

  it("extractPaymentScheme() returns null when no Payment scheme present", () => {
    const bearerHeader = "Bearer eyJhbGciOiJSUzI1NiJ9.test";
    const extracted = Credential.extractPaymentScheme(bearerHeader);

    expect(extracted).toBeNull();
  });

  it("credential contains challenge reference and payload", () => {
    const challenge = createTestChallenge();
    const payload = { signature: "0xsig", nonce: "abc" };

    const credential = Credential.from({ challenge, payload });

    expect(credential.challenge).toStrictEqual(challenge);
    expect(credential.payload).toStrictEqual(payload);
  });
});
