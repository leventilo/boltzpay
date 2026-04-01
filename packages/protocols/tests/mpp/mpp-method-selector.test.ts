import { Money } from "@boltzpay/core";
import { describe, expect, it } from "vitest";
import {
  MppMethodSelector,
  type MppResolvedMethod,
} from "../../src/mpp/mpp-method-selector";

function method(
  name: string,
  intent: string,
  cents: bigint,
  currency = "USD",
): MppResolvedMethod {
  return {
    method: name,
    intent,
    amount: Money.fromCents(cents),
    currency,
    network: undefined,
    recipient: undefined,
  };
}

function satMethod(
  name: string,
  sats: bigint,
): MppResolvedMethod {
  return {
    method: name,
    intent: "charge",
    amount: Money.fromSatoshis(sats),
    currency: "BTC",
    network: undefined,
    recipient: undefined,
  };
}

describe("MppMethodSelector", () => {
  describe("wallet-first selection", () => {
    it("filters methods by configured wallet types and returns cheapest", () => {
      const selector = new MppMethodSelector(
        new Set(["stripe-mpp", "tempo"]),
        [],
      );
      const methods = [
        method("stripe", "charge", 500n),
        method("tempo", "charge", 100n),
        method("lightning", "charge", 50n),
      ];

      const selected = selector.select(methods);
      expect(selected.method).toBe("tempo");
    });

    it("maps nwc wallet type to lightning method", () => {
      const selector = new MppMethodSelector(new Set(["nwc"]), []);
      const methods = [
        method("stripe", "charge", 500n),
        method("lightning", "charge", 50n),
      ];

      const selected = selector.select(methods);
      expect(selected.method).toBe("lightning");
    });

    it("maps visa-mpp wallet type to card method", () => {
      const selector = new MppMethodSelector(new Set(["visa-mpp"]), []);
      const methods = [
        method("card", "charge", 500n),
        method("stripe", "charge", 100n),
      ];

      const selected = selector.select(methods);
      expect(selected.method).toBe("card");
    });
  });

  describe("preferredMethods override", () => {
    it("returns first matching preferred method regardless of price", () => {
      const selector = new MppMethodSelector(
        new Set(["stripe-mpp", "tempo"]),
        ["stripe", "tempo"],
      );
      const methods = [
        method("tempo", "charge", 100n),
        method("stripe", "charge", 500n),
      ];

      const selected = selector.select(methods);
      expect(selected.method).toBe("stripe");
    });

    it("skips preferred methods not in available list", () => {
      const selector = new MppMethodSelector(
        new Set(["tempo"]),
        ["lightning", "tempo"],
      );
      const methods = [
        method("tempo", "charge", 100n),
        method("stripe", "charge", 50n),
      ];

      const selected = selector.select(methods);
      expect(selected.method).toBe("tempo");
    });
  });

  describe("fallback to cheapest", () => {
    it("returns cheapest overall when no wallets configured", () => {
      const selector = new MppMethodSelector(new Set(), []);
      const methods = [
        method("stripe", "charge", 500n),
        method("tempo", "charge", 100n),
        method("lightning", "charge", 200n),
      ];

      const selected = selector.select(methods);
      expect(selected.method).toBe("tempo");
    });

    it("returns cheapest when no compatible wallet methods found", () => {
      const selector = new MppMethodSelector(new Set(["visa-mpp"]), []);
      const methods = [
        method("stripe", "charge", 500n),
        method("tempo", "charge", 100n),
      ];

      const selected = selector.select(methods);
      expect(selected.method).toBe("tempo");
    });

    it("sorts zero-amount methods last", () => {
      const selector = new MppMethodSelector(new Set(), []);
      const methods = [
        method("tempo", "charge", 0n),
        method("stripe", "charge", 100n),
      ];

      const selected = selector.select(methods);
      expect(selected.method).toBe("stripe");
    });

    it("returns zero-amount method if all are zero", () => {
      const selector = new MppMethodSelector(new Set(), []);
      const methods = [
        method("tempo", "charge", 0n),
        method("stripe", "charge", 0n),
      ];

      const selected = selector.select(methods);
      expect(selected.amount.isZero()).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("returns the only method when list has one entry", () => {
      const selector = new MppMethodSelector(new Set(), []);
      const methods = [method("tempo", "charge", 100n)];

      const selected = selector.select(methods);
      expect(selected.method).toBe("tempo");
    });

    it("handles sats-denominated methods in sorting", () => {
      const selector = new MppMethodSelector(new Set(["nwc"]), []);
      const methods = [satMethod("lightning", 1000n)];

      const selected = selector.select(methods);
      expect(selected.method).toBe("lightning");
      expect(selected.amount.cents).toBe(1000n);
    });
  });
});
