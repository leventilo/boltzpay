import { describe, expect, it } from "vitest";
import { BoltzPayResponse } from "../../src/response/boltzpay-response";

function createTestResponse(
  overrides: Partial<ConstructorParameters<typeof BoltzPayResponse>[0]> = {},
): BoltzPayResponse {
  return new BoltzPayResponse({
    ok: true,
    status: 200,
    headers: { "content-type": "application/json" },
    rawBody: new TextEncoder().encode('{"result":"ok"}'),
    ...overrides,
  });
}

describe("BoltzPayResponse", () => {
  it("should expose readonly properties from init", () => {
    const response = createTestResponse({ status: 201, protocol: "x402" });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(201);
    expect(response.protocol).toBe("x402");
    expect(response.headers["content-type"]).toBe("application/json");
  });

  it("should return parsed JSON via json()", async () => {
    const response = createTestResponse();
    const data = await response.json<{ result: string }>();

    expect(data.result).toBe("ok");
  });

  it("should return raw text via text()", async () => {
    const response = createTestResponse();
    const text = await response.text();

    expect(text).toBe('{"result":"ok"}');
  });

  it("should return ReadableStream from body getter", () => {
    const response = createTestResponse();

    expect(response.body).toBeInstanceOf(ReadableStream);
  });

  it("should return null body for empty rawBody", () => {
    const response = createTestResponse({ rawBody: new Uint8Array() });

    expect(response.body).toBeNull();
  });

  it("should expose payment details when present", () => {
    const payment = {
      protocol: "x402" as const,
      amount: { cents: 100n, currency: "USD" as const } as never,
      url: "https://example.com",
      timestamp: new Date(),
      txHash: "0xabc",
    };
    const response = createTestResponse({ payment, protocol: "x402" });

    expect(response.payment).toBe(payment);
    expect(response.protocol).toBe("x402");
  });

  it("should have undefined payment for free responses", () => {
    const response = createTestResponse();

    expect(response.payment).toBeUndefined();
    expect(response.protocol).toBeUndefined();
  });
});
