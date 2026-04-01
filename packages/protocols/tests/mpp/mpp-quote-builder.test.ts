import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import { MppMethodSelector } from "../../src/mpp/mpp-method-selector";
import { buildMppQuote } from "../../src/mpp/mpp-quote-builder";
import type { MppChallenge } from "../../src/mpp/mpp-types";
import { MppQuoteError } from "../../src/adapter-error";

const tempoCharge: MppChallenge = {
  id: "c1",
  method: "tempo",
  intent: "charge",
  realm: undefined,
  expires: undefined,
  request: {
    amount: "1000000",
    currency: "USDC",
    recipient: "0xabc",
    chainId: 42161,
    methodDetails: undefined,
  },
};

const stripeCharge: MppChallenge = {
  id: "c2",
  method: "stripe",
  intent: "charge",
  realm: undefined,
  expires: undefined,
  request: {
    amount: "500",
    currency: "USD",
    recipient: "acct_123",
    chainId: undefined,
    methodDetails: undefined,
  },
};

const lightningCharge: MppChallenge = {
  id: "c3",
  method: "lightning",
  intent: "charge",
  realm: undefined,
  expires: undefined,
  request: {
    amount: "1000",
    currency: "BTC",
    recipient: "lnbc1...",
    chainId: undefined,
    methodDetails: undefined,
  },
};

const sessionOnly: MppChallenge = {
  id: "c4",
  method: "tempo",
  intent: "session",
  realm: undefined,
  expires: undefined,
  request: {
    amount: "0",
    currency: "USDC",
    recipient: "0xabc",
    chainId: 42161,
    methodDetails: undefined,
  },
};

const noRequest: MppChallenge = {
  id: "c5",
  method: "tempo",
  intent: "charge",
  realm: undefined,
  expires: undefined,
  request: undefined,
};

function defaultSelector(): MppMethodSelector {
  return new MppMethodSelector(new Set(), []);
}

describe("buildMppQuote", () => {
  describe("single charge challenge", () => {
    it("returns ProtocolQuote with stripe charge converted via Money.fromCents", () => {
      const quote = buildMppQuote([stripeCharge], defaultSelector());
      expect(quote.protocol).toBe("mpp");
      expect(quote.scheme).toBe("mpp");
      expect(quote.selectedMethod).toBe("stripe");
      expect(quote.amount.cents).toBe(500n);
      expect(quote.amount.currency).toBe("USD");
      expect(quote.payTo).toBe("acct_123");
      expect(quote.allMethods).toBeUndefined();
    });

    it("returns ProtocolQuote with tempo charge using usdcAtomicToCents", () => {
      const quote = buildMppQuote([tempoCharge], defaultSelector());
      expect(quote.protocol).toBe("mpp");
      expect(quote.selectedMethod).toBe("tempo");
      // 1_000_000 atomic / 10_000 = 100 cents = $1.00
      expect(quote.amount.cents).toBe(100n);
      expect(quote.amount.currency).toBe("USD");
      expect(quote.payTo).toBe("0xabc");
    });

    it("returns ProtocolQuote with lightning charge via Money.fromSatoshis", () => {
      const quote = buildMppQuote([lightningCharge], defaultSelector());
      expect(quote.protocol).toBe("mpp");
      expect(quote.selectedMethod).toBe("lightning");
      expect(quote.amount.cents).toBe(1000n);
      expect(quote.amount.currency).toBe("SATS");
      expect(quote.payTo).toBe("lnbc1...");
    });
  });

  describe("multi-method challenges", () => {
    it("selects cheapest and includes allMethods when multiple methods", () => {
      const selector = new MppMethodSelector(new Set(), []);
      const quote = buildMppQuote([tempoCharge, stripeCharge], selector);

      expect(quote.allMethods).toBeDefined();
      expect(quote.allMethods).toHaveLength(2);
      // Tempo: 100 cents, Stripe: 500 cents -> tempo is cheapest
      expect(quote.selectedMethod).toBe("tempo");
      expect(quote.amount.cents).toBe(100n);
    });

    it("allMethods contains both methods with correct amounts", () => {
      const quote = buildMppQuote(
        [tempoCharge, stripeCharge],
        defaultSelector(),
      );
      const methods = quote.allMethods!;
      const tempoMethod = methods.find((m) => m.method === "tempo");
      const stripeMethod = methods.find((m) => m.method === "stripe");

      expect(tempoMethod).toBeDefined();
      expect(tempoMethod!.amount.cents).toBe(100n);
      expect(stripeMethod).toBeDefined();
      expect(stripeMethod!.amount.cents).toBe(500n);
    });
  });

  describe("error cases", () => {
    it("throws MppQuoteError when only session challenges present", () => {
      expect(() => buildMppQuote([sessionOnly], defaultSelector())).toThrow(
        MppQuoteError,
      );
    });

    it("throws MppQuoteError when empty challenges array", () => {
      expect(() => buildMppQuote([], defaultSelector())).toThrow(
        MppQuoteError,
      );
    });

    it("throws MppQuoteError for negative amount", () => {
      const negative: MppChallenge = {
        id: "neg",
        method: "stripe",
        intent: "charge",
        realm: undefined,
        expires: undefined,
        request: {
          amount: "-100",
          currency: "USD",
          recipient: "acct_123",
          chainId: undefined,
          methodDetails: undefined,
        },
      };
      expect(() => buildMppQuote([negative], defaultSelector())).toThrow(
        MppQuoteError,
      );
    });
  });

  describe("no-request challenge", () => {
    it("returns Money.zero() with priceUnknown=true", () => {
      const quote = buildMppQuote([noRequest], defaultSelector());
      expect(quote.amount.isZero()).toBe(true);
      expect(quote.priceUnknown).toBe(true);
      expect(quote.selectedMethod).toBe("tempo");
    });
  });

  describe("mixed charge and session", () => {
    it("ignores session challenges and quotes only charge", () => {
      const quote = buildMppQuote(
        [sessionOnly, stripeCharge],
        defaultSelector(),
      );
      expect(quote.selectedMethod).toBe("stripe");
      expect(quote.amount.cents).toBe(500n);
      expect(quote.allMethods).toBeUndefined();
    });
  });
});
