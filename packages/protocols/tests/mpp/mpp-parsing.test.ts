import { describe, expect, it } from "vitest";

import {
  decodeBase64Url,
  decodeMppRequest,
  hasMppScheme,
  parseMppChallenges,
  parseMppParams,
  parseSingleChallenge,
  splitChallenges,
} from "../../src/mpp/mpp-parsing";

function encodeBase64Url(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const TEMPO_REQUEST = {
  amount: "10000",
  currency: "0x20C0D54F37EF0E3B2A5E3a7C9Ab0bFe15f2F1b80",
  recipient: "0x10409f8a084D05AbC4E12A8dD8d4CeDF41F06Ce2",
  methodDetails: { chainId: 4217 },
};

const STRIPE_REQUEST = {
  amount: "1000",
  currency: "usd",
  recipient: "acct_1234567890",
  methodDetails: { paymentMethodTypes: ["card"] },
};

describe("hasMppScheme", () => {
  it("detects Payment scheme with quoted params", () => {
    expect(hasMppScheme('Payment id="abc", method="tempo"')).toBe(true);
  });

  it("detects Payment scheme with unquoted params", () => {
    expect(hasMppScheme("Payment method=tempo")).toBe(true);
  });

  it("detects Payment scheme case-insensitively", () => {
    expect(hasMppScheme('payment method="tempo"')).toBe(true);
    expect(hasMppScheme('PAYMENT method="tempo"')).toBe(true);
  });

  it("rejects x402 scheme", () => {
    expect(hasMppScheme('x402 address="0xabc", amount="0.01"')).toBe(false);
  });

  it("rejects L402 scheme", () => {
    expect(hasMppScheme('L402 macaroon="abc", invoice="lnbc..."')).toBe(false);
  });

  it("rejects empty string", () => {
    expect(hasMppScheme("")).toBe(false);
  });

  it("rejects Payment without params", () => {
    expect(hasMppScheme("Payment")).toBe(false);
  });
});

describe("splitChallenges", () => {
  it("splits single challenge", () => {
    const result = splitChallenges('Payment id="a", method="tempo"');
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("method");
  });

  it("splits two challenges", () => {
    const header =
      'Payment id="a", method="tempo", intent="charge", ' +
      'Payment id="b", method="stripe", intent="charge"';
    const result = splitChallenges(header);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("tempo");
    expect(result[1]).toContain("stripe");
  });

  it("handles extra whitespace between challenges", () => {
    const header =
      'Payment   method="tempo",   Payment   method="stripe"';
    const result = splitChallenges(header);
    expect(result).toHaveLength(2);
  });
});

describe("parseMppParams", () => {
  it("parses quoted values", () => {
    const result = parseMppParams('id="abc", method="tempo"');
    expect(result.id).toBe("abc");
    expect(result.method).toBe("tempo");
  });

  it("parses unquoted values", () => {
    const result = parseMppParams("method=tempo, intent=charge");
    expect(result.method).toBe("tempo");
    expect(result.intent).toBe("charge");
  });

  it("normalizes keys to lowercase", () => {
    const result = parseMppParams('Method="tempo", Intent="charge"');
    expect(result.method).toBe("tempo");
    expect(result.intent).toBe("charge");
  });

  it("handles mixed quoted and unquoted", () => {
    const result = parseMppParams('id="abc", method=tempo');
    expect(result.id).toBe("abc");
    expect(result.method).toBe("tempo");
  });

  it("returns empty for empty string", () => {
    expect(parseMppParams("")).toEqual({});
  });
});

describe("parseSingleChallenge", () => {
  it("parses challenge with all fields", () => {
    const encoded = encodeBase64Url(TEMPO_REQUEST);
    const content =
      `id="x7Tg", method="tempo", intent="charge", ` +
      `realm="api.example.com", expires="2025-01-15T12:05:00Z", request="${encoded}"`;
    const result = parseSingleChallenge(content);
    expect(result).toBeDefined();
    expect(result?.method).toBe("tempo");
    expect(result?.intent).toBe("charge");
    expect(result?.id).toBe("x7Tg");
    expect(result?.realm).toBe("api.example.com");
    expect(result?.expires).toBe("2025-01-15T12:05:00Z");
    expect(result?.request?.amount).toBe("10000");
    expect(result?.request?.chainId).toBe(4217);
  });

  it("defaults intent to charge when missing", () => {
    const result = parseSingleChallenge('method="tempo"');
    expect(result?.intent).toBe("charge");
  });

  it("returns undefined when method is missing", () => {
    const result = parseSingleChallenge('id="abc", intent="charge"');
    expect(result).toBeUndefined();
  });

  it("parses session intent", () => {
    const result = parseSingleChallenge(
      'method="lightning", intent="session"',
    );
    expect(result?.method).toBe("lightning");
    expect(result?.intent).toBe("session");
  });

  it("parses challenge without request param", () => {
    const result = parseSingleChallenge(
      'id="abc", method="stripe", intent="charge"',
    );
    expect(result).toBeDefined();
    expect(result?.method).toBe("stripe");
    expect(result?.request).toBeUndefined();
  });
});

describe("decodeBase64Url", () => {
  it("decodes standard base64url", () => {
    const original = '{"amount":"10000"}';
    const encoded = btoa(original)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeBase64Url(encoded)).toBe(original);
  });

  it("handles padding correctly", () => {
    const original = "ab";
    const encoded = btoa(original).replace(/=+$/, "");
    expect(decodeBase64Url(encoded)).toBe(original);
  });

  it("handles regular base64 (with + and /)", () => {
    const original = '{"key":"value with spaces"}';
    const encoded = btoa(original);
    expect(decodeBase64Url(encoded)).toBe(original);
  });
});

describe("decodeMppRequest", () => {
  it("decodes valid tempo request", () => {
    const encoded = encodeBase64Url(TEMPO_REQUEST);
    const result = decodeMppRequest(encoded);
    expect(result).toBeDefined();
    expect(result?.amount).toBe("10000");
    expect(result?.currency).toBe(TEMPO_REQUEST.currency);
    expect(result?.recipient).toBe(TEMPO_REQUEST.recipient);
    expect(result?.chainId).toBe(4217);
    expect(result?.methodDetails).toEqual({ chainId: 4217 });
  });

  it("decodes valid stripe request", () => {
    const encoded = encodeBase64Url(STRIPE_REQUEST);
    const result = decodeMppRequest(encoded);
    expect(result).toBeDefined();
    expect(result?.amount).toBe("1000");
    expect(result?.currency).toBe("usd");
    expect(result?.recipient).toBe("acct_1234567890");
    expect(result?.chainId).toBeUndefined();
  });

  it("returns undefined for missing required fields", () => {
    const encoded = encodeBase64Url({ amount: "100" });
    expect(decodeMppRequest(encoded)).toBeUndefined();
  });

  it("returns undefined for invalid base64", () => {
    expect(decodeMppRequest("!!!not-base64!!!")).toBeUndefined();
  });

  it("returns undefined for non-JSON content", () => {
    const encoded = btoa("this is not json");
    expect(decodeMppRequest(encoded)).toBeUndefined();
  });

  it("returns undefined for non-object JSON", () => {
    const encoded = btoa('"just a string"');
    expect(decodeMppRequest(encoded)).toBeUndefined();
  });

  it("returns undefined for null JSON", () => {
    const encoded = btoa("null");
    expect(decodeMppRequest(encoded)).toBeUndefined();
  });

  it("handles request without methodDetails", () => {
    const encoded = encodeBase64Url({
      amount: "500",
      currency: "usd",
      recipient: "acct_test",
    });
    const result = decodeMppRequest(encoded);
    expect(result).toBeDefined();
    expect(result?.chainId).toBeUndefined();
    expect(result?.methodDetails).toBeUndefined();
  });
});

describe("parseMppChallenges", () => {
  it("parses single tempo challenge", () => {
    const encoded = encodeBase64Url(TEMPO_REQUEST);
    const header = `Payment id="x7Tg", method="tempo", intent="charge", request="${encoded}"`;
    const { challenges } = parseMppChallenges(header);
    expect(challenges).toHaveLength(1);
    expect(challenges[0]?.method).toBe("tempo");
    expect(challenges[0]?.request?.amount).toBe("10000");
    expect(challenges[0]?.request?.chainId).toBe(4217);
  });

  it("parses multi-method Browserbase-style header", () => {
    const tempoReq = encodeBase64Url(TEMPO_REQUEST);
    const stripeReq = encodeBase64Url(STRIPE_REQUEST);
    const header =
      `Payment id="a1", method="tempo", intent="charge", request="${tempoReq}", ` +
      `Payment id="b2", method="stripe", intent="charge", request="${stripeReq}"`;
    const { challenges } = parseMppChallenges(header);
    expect(challenges).toHaveLength(2);
    expect(challenges[0]?.method).toBe("tempo");
    expect(challenges[0]?.request?.chainId).toBe(4217);
    expect(challenges[1]?.method).toBe("stripe");
    expect(challenges[1]?.request?.currency).toBe("usd");
  });

  it("returns empty for non-MPP header", () => {
    const { challenges } = parseMppChallenges(
      'x402 address="0xabc", amount="0.01"',
    );
    expect(challenges).toHaveLength(0);
  });

  it("returns empty for empty string", () => {
    const { challenges } = parseMppChallenges("");
    expect(challenges).toHaveLength(0);
  });

  it("skips challenges missing method param", () => {
    const header =
      'Payment id="a1", intent="charge", ' +
      'Payment id="b2", method="stripe", intent="charge"';
    const { challenges } = parseMppChallenges(header);
    expect(challenges).toHaveLength(1);
    expect(challenges[0]?.method).toBe("stripe");
  });

  it("handles session intent for lightning streaming", () => {
    const header = 'Payment method="lightning", intent="session"';
    const { challenges } = parseMppChallenges(header);
    expect(challenges).toHaveLength(1);
    expect(challenges[0]?.intent).toBe("session");
  });

  it("handles case-insensitive scheme", () => {
    const header = 'payment method="tempo", intent="charge"';
    const { challenges } = parseMppChallenges(header);
    expect(challenges).toHaveLength(1);
    expect(challenges[0]?.method).toBe("tempo");
  });

  it("handles malformed request gracefully", () => {
    const header = 'Payment method="tempo", request="not-valid-base64-json"';
    const { challenges } = parseMppChallenges(header);
    expect(challenges).toHaveLength(1);
    expect(challenges[0]?.method).toBe("tempo");
    expect(challenges[0]?.request).toBeUndefined();
  });

  it("parses four payment methods", () => {
    const header =
      'Payment method="tempo", intent="charge", ' +
      'Payment method="stripe", intent="charge", ' +
      'Payment method="lightning", intent="session", ' +
      'Payment method="card", intent="charge"';
    const { challenges } = parseMppChallenges(header);
    expect(challenges).toHaveLength(4);
    expect(challenges.map((c) => c.method)).toEqual([
      "tempo",
      "stripe",
      "lightning",
      "card",
    ]);
  });
});
