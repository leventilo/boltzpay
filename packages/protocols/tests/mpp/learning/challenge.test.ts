import { describe, expect, it } from "vitest";
import { Challenge, Credential } from "mppx";
import { Methods as TempoMethods } from "mppx/tempo";
import { Methods as StripeMethods } from "mppx/stripe";

describe("mppx Challenge (learning tests)", () => {
  const REALM = "api.example.com";
  const SECRET = "test-secret-key-for-hmac";

  const tempoRequest = {
    amount: "1000000",
    currency: "0x20c0000000000000000000000000000000000001",
    decimals: 6,
    recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  };

  const stripeRequest = {
    amount: "500",
    currency: "usd",
    decimals: 2,
    networkId: "acct_abc123",
    paymentMethodTypes: ["card"],
  };

  it("from() creates a challenge with explicit id", () => {
    const challenge = Challenge.from({
      id: "test-id-123",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
    });

    expect(challenge.id).toBe("test-id-123");
    expect(challenge.realm).toBe(REALM);
    expect(challenge.method).toBe("tempo");
    expect(challenge.intent).toBe("charge");
    expect(challenge.request).toBeDefined();
  });

  it("from() creates a challenge with HMAC-bound id via secretKey", () => {
    const challenge = Challenge.from(
      {
        secretKey: SECRET,
        realm: REALM,
        method: "tempo",
        intent: "charge",
        request: tempoRequest,
      },
    );

    expect(challenge.id).toBeDefined();
    expect(typeof challenge.id).toBe("string");
    expect(challenge.id.length).toBeGreaterThan(0);
    expect(challenge.method).toBe("tempo");
  });

  it("fromMethod() creates a validated challenge for tempo charge", () => {
    const challenge = Challenge.fromMethod(TempoMethods.charge, {
      secretKey: SECRET,
      realm: REALM,
      request: tempoRequest,
    });

    expect(challenge.method).toBe("tempo");
    expect(challenge.intent).toBe("charge");
    expect(challenge.realm).toBe(REALM);
  });

  it("fromMethod() creates a validated challenge for stripe charge", () => {
    const challenge = Challenge.fromMethod(StripeMethods.charge, {
      secretKey: SECRET,
      realm: REALM,
      request: stripeRequest,
    });

    expect(challenge.method).toBe("stripe");
    expect(challenge.intent).toBe("charge");
  });

  it("serialize() produces a WWW-Authenticate header value starting with 'Payment '", () => {
    const challenge = Challenge.from({
      id: "serial-test",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
    });

    const header = Challenge.serialize(challenge);

    expect(typeof header).toBe("string");
    expect(header.startsWith("Payment ")).toBe(true);
  });

  it("deserialize() round-trips: serialize then deserialize produces equivalent challenge", () => {
    const original = Challenge.from({
      id: "roundtrip-test",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
    });

    const serialized = Challenge.serialize(original);
    const deserialized = Challenge.deserialize(serialized);

    expect(deserialized.id).toBe(original.id);
    expect(deserialized.realm).toBe(original.realm);
    expect(deserialized.method).toBe(original.method);
    expect(deserialized.intent).toBe(original.intent);
  });

  it("deserializeList() handles multiple challenges from a merged header", () => {
    const tempoChallenge = Challenge.from({
      id: "tempo-1",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
    });

    const stripeChallenge = Challenge.from({
      id: "stripe-1",
      realm: REALM,
      method: "stripe",
      intent: "charge",
      request: stripeRequest,
    });

    const mergedHeader = [
      Challenge.serialize(tempoChallenge),
      Challenge.serialize(stripeChallenge),
    ].join(", ");

    const challenges = Challenge.deserializeList(mergedHeader);

    expect(challenges).toHaveLength(2);
    expect(challenges[0].method).toBe("tempo");
    expect(challenges[1].method).toBe("stripe");
  });

  it("fromResponse() extracts challenge from a 402 Response", () => {
    const challenge = Challenge.from({
      id: "from-response",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
    });

    const header = Challenge.serialize(challenge);
    const response = new Response(null, {
      status: 402,
      headers: { "WWW-Authenticate": header },
    });

    const extracted = Challenge.fromResponse(response);

    expect(extracted.id).toBe("from-response");
    expect(extracted.method).toBe("tempo");
    expect(extracted.intent).toBe("charge");
  });

  it("fromResponseList() extracts all challenges from a multi-challenge Response", () => {
    const tempo = Challenge.from({
      id: "list-tempo",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
    });
    const stripe = Challenge.from({
      id: "list-stripe",
      realm: REALM,
      method: "stripe",
      intent: "charge",
      request: stripeRequest,
    });

    const merged = [Challenge.serialize(tempo), Challenge.serialize(stripe)].join(", ");
    const response = new Response(null, {
      status: 402,
      headers: { "WWW-Authenticate": merged },
    });

    const extracted = Challenge.fromResponseList(response);

    expect(extracted.length).toBeGreaterThanOrEqual(2);
    const methods = extracted.map((c) => c.method);
    expect(methods).toContain("tempo");
    expect(methods).toContain("stripe");
  });

  it("fromHeaders() extracts challenge from Headers object", () => {
    const challenge = Challenge.from({
      id: "from-headers",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
    });

    const header = Challenge.serialize(challenge);
    const headers = new Headers({ "WWW-Authenticate": header });

    const extracted = Challenge.fromHeaders(headers);

    expect(extracted.id).toBe("from-headers");
    expect(extracted.method).toBe("tempo");
  });

  it("fromHeadersList() extracts list from Headers object", () => {
    const tempo = Challenge.from({
      id: "hlist-tempo",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
    });
    const stripe = Challenge.from({
      id: "hlist-stripe",
      realm: REALM,
      method: "stripe",
      intent: "charge",
      request: stripeRequest,
    });

    const merged = [Challenge.serialize(tempo), Challenge.serialize(stripe)].join(", ");
    const headers = new Headers({ "WWW-Authenticate": merged });

    const extracted = Challenge.fromHeadersList(headers);

    expect(extracted.length).toBeGreaterThanOrEqual(2);
  });

  it("verify() with secretKey validates HMAC-bound challenge ID", () => {
    const challenge = Challenge.from(
      {
        secretKey: SECRET,
        realm: REALM,
        method: "tempo",
        intent: "charge",
        request: tempoRequest,
      },
    );

    const isValid = Challenge.verify(challenge, { secretKey: SECRET });
    expect(isValid).toBe(true);
  });

  it("verify() rejects tampered challenge", () => {
    const challenge = Challenge.from(
      {
        secretKey: SECRET,
        realm: REALM,
        method: "tempo",
        intent: "charge",
        request: tempoRequest,
      },
    );

    const tampered = { ...challenge, realm: "hacked.example.com" };
    const isValid = Challenge.verify(tampered, { secretKey: SECRET });
    expect(isValid).toBe(false);
  });

  it("meta() extracts opaque metadata from challenge", () => {
    const challenge = Challenge.from({
      id: "meta-test",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
      meta: { orderId: "order-123", userId: "user-456" },
    });

    const metadata = Challenge.meta(challenge);

    expect(metadata).toBeDefined();
    expect(metadata).toEqual({ orderId: "order-123", userId: "user-456" });
  });

  it("Schema validates correct challenge shape", () => {
    const validData = {
      id: "schema-test",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
    };

    const result = Challenge.Schema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("Schema rejects invalid challenge (missing required fields)", () => {
    const invalidData = {
      id: "invalid",
      realm: REALM,
    };

    const result = Challenge.Schema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("challenge with description preserves it through serialization", () => {
    const challenge = Challenge.from({
      id: "desc-test",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
      description: "Access to premium API",
    });

    expect(challenge.description).toBe("Access to premium API");

    const serialized = Challenge.serialize(challenge);
    const deserialized = Challenge.deserialize(serialized);
    expect(deserialized.description).toBe("Access to premium API");
  });

  it("challenge with expires preserves it through serialization", () => {
    const expires = "2026-12-31T23:59:59Z";
    const challenge = Challenge.from({
      id: "exp-test",
      realm: REALM,
      method: "tempo",
      intent: "charge",
      request: tempoRequest,
      expires,
    });

    expect(challenge.expires).toBe(expires);

    const serialized = Challenge.serialize(challenge);
    const deserialized = Challenge.deserialize(serialized);
    expect(deserialized.expires).toBe(expires);
  });
});
