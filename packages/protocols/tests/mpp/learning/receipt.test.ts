import { describe, expect, it } from "vitest";
import { Receipt } from "mppx";

describe("mppx Receipt (learning tests)", () => {
  const TIMESTAMP = "2026-03-19T12:00:00Z";

  it("from() creates receipt with method, status, timestamp, reference", () => {
    const receipt = Receipt.from({
      method: "tempo",
      status: "success",
      timestamp: TIMESTAMP,
      reference: "0xabc123def456",
    });

    expect(receipt.method).toBe("tempo");
    expect(receipt.status).toBe("success");
    expect(receipt.timestamp).toBe(TIMESTAMP);
    expect(receipt.reference).toBe("0xabc123def456");
  });

  it("from() creates receipt with optional externalId", () => {
    const receipt = Receipt.from({
      method: "stripe",
      status: "success",
      timestamp: TIMESTAMP,
      reference: "pi_test_123",
      externalId: "order-456",
    });

    expect(receipt.externalId).toBe("order-456");
  });

  it("Schema validates correct receipt shape", () => {
    const validData = {
      method: "tempo",
      status: "success",
      timestamp: TIMESTAMP,
      reference: "0xabc",
    };

    const result = Receipt.Schema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("Schema rejects invalid status (must be 'success')", () => {
    const invalidData = {
      method: "tempo",
      status: "failed",
      timestamp: TIMESTAMP,
      reference: "0xabc",
    };

    const result = Receipt.Schema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("serialize() encodes to base64url for Payment-Receipt header", () => {
    const receipt = Receipt.from({
      method: "tempo",
      status: "success",
      timestamp: TIMESTAMP,
      reference: "0xdeadbeef",
    });

    const serialized = Receipt.serialize(receipt);

    expect(typeof serialized).toBe("string");
    expect(serialized.length).toBeGreaterThan(0);
  });

  it("deserialize() decodes and restores all fields", () => {
    const original = Receipt.from({
      method: "stripe",
      status: "success",
      timestamp: TIMESTAMP,
      reference: "pi_abc",
    });

    const serialized = Receipt.serialize(original);
    const deserialized = Receipt.deserialize(serialized);

    expect(deserialized.method).toBe("stripe");
    expect(deserialized.status).toBe("success");
    expect(deserialized.timestamp).toBe(TIMESTAMP);
    expect(deserialized.reference).toBe("pi_abc");
  });

  it("fromResponse() extracts receipt from Response Payment-Receipt header", () => {
    const receipt = Receipt.from({
      method: "tempo",
      status: "success",
      timestamp: TIMESTAMP,
      reference: "0x123",
    });

    const serialized = Receipt.serialize(receipt);
    const response = new Response("OK", {
      status: 200,
      headers: { "Payment-Receipt": serialized },
    });

    const extracted = Receipt.fromResponse(response);

    expect(extracted.method).toBe("tempo");
    expect(extracted.status).toBe("success");
    expect(extracted.reference).toBe("0x123");
  });

  it("round-trip: from -> serialize -> deserialize produces equivalent receipt", () => {
    const original = Receipt.from({
      method: "tempo",
      status: "success",
      timestamp: TIMESTAMP,
      reference: "0xfull-roundtrip",
      externalId: "ext-id-789",
    });

    const roundTripped = Receipt.deserialize(Receipt.serialize(original));

    expect(roundTripped).toEqual(original);
  });
});
