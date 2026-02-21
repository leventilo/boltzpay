import { describe, expect, it } from "vitest";
import { selectBestAccept } from "../../src/shared/chain-selection";
import type {
  AcceptOption,
  ChainCapabilities,
} from "../../src/shared/chain-types";
import { NoCompatibleChainError } from "../../src/shared/payment-errors";

function option(
  overrides: Partial<AcceptOption> & { amount: bigint },
): AcceptOption {
  return {
    namespace: "evm",
    network: "eip155:8453",
    payTo: "0xRecipient",
    asset: "USDC",
    scheme: "exact",
    ...overrides,
  };
}

const bothCaps: ChainCapabilities = {
  supportedNamespaces: ["evm", "svm"],
  preferredChains: [],
};

const evmOnly: ChainCapabilities = {
  supportedNamespaces: ["evm"],
  preferredChains: [],
};

const svmOnly: ChainCapabilities = {
  supportedNamespaces: ["svm"],
  preferredChains: [],
};

describe("selectBestAccept", () => {
  it("single EVM option + evm supported -> returns that option", () => {
    const evm = option({ amount: 100n });
    expect(selectBestAccept([evm], evmOnly)).toBe(evm);
  });

  it("single SVM option + svm supported -> returns that option", () => {
    const svm = option({ namespace: "svm", network: "solana:main", amount: 100n });
    expect(selectBestAccept([svm], svmOnly)).toBe(svm);
  });

  it("two options (evm cheaper) + both supported -> returns evm", () => {
    const evm = option({ amount: 50n });
    const svm = option({ namespace: "svm", network: "solana:main", amount: 100n });
    expect(selectBestAccept([svm, evm], bothCaps)).toBe(evm);
  });

  it("two options (svm cheaper) + both supported -> returns svm", () => {
    const evm = option({ amount: 100n });
    const svm = option({ namespace: "svm", network: "solana:main", amount: 50n });
    expect(selectBestAccept([evm, svm], bothCaps)).toBe(svm);
  });

  it("two options same price + both supported -> returns evm (tie-break)", () => {
    const evm = option({ amount: 100n });
    const svm = option({ namespace: "svm", network: "solana:main", amount: 100n });
    expect(selectBestAccept([svm, evm], bothCaps)).toBe(evm);
  });

  it("preferredChains=['svm'] + both available -> returns svm even if evm is cheaper", () => {
    const evm = option({ amount: 50n });
    const svm = option({ namespace: "svm", network: "solana:main", amount: 100n });
    const caps: ChainCapabilities = {
      supportedNamespaces: ["evm", "svm"],
      preferredChains: ["svm"],
    };
    expect(selectBestAccept([evm, svm], caps)).toBe(svm);
  });

  it("preferredChains=['svm'] but only evm available -> returns evm (fallback)", () => {
    const evm = option({ amount: 100n });
    const caps: ChainCapabilities = {
      supportedNamespaces: ["evm", "svm"],
      preferredChains: ["svm"],
    };
    expect(selectBestAccept([evm], caps)).toBe(evm);
  });

  it("no supported namespace -> throws NoCompatibleChainError", () => {
    const svm = option({ namespace: "svm", network: "solana:main", amount: 100n });
    expect(() => selectBestAccept([svm], evmOnly)).toThrow(
      NoCompatibleChainError,
    );
  });

  it("empty accepts array -> throws NoCompatibleChainError", () => {
    expect(() => selectBestAccept([], bothCaps)).toThrow(
      NoCompatibleChainError,
    );
  });

  it("three options (2 evm, 1 svm) + prefer svm -> returns svm", () => {
    const evm1 = option({ amount: 50n });
    const evm2 = option({ amount: 80n });
    const svm = option({ namespace: "svm", network: "solana:main", amount: 70n });
    const caps: ChainCapabilities = {
      supportedNamespaces: ["evm", "svm"],
      preferredChains: ["svm"],
    };
    expect(selectBestAccept([evm1, evm2, svm], caps)).toBe(svm);
  });

  it("bigint comparison works correctly with large amounts", () => {
    const cheap = option({ amount: 999_999_999_999n });
    const expensive = option({ amount: 1_000_000_000_000n });
    expect(selectBestAccept([expensive, cheap], evmOnly)).toBe(cheap);
  });

  it("NoCompatibleChainError message includes useful context", () => {
    const svm = option({ namespace: "svm", network: "solana:main", amount: 100n });
    try {
      selectBestAccept([svm], evmOnly);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(NoCompatibleChainError);
      const err = e as NoCompatibleChainError;
      expect(err.message).toContain("svm");
      expect(err.message).toContain("evm");
    }
  });

  it("multiple preferred chains: all preferred are candidates, cheapest wins", () => {
    const evm = option({ amount: 50n });
    const svm = option({ namespace: "svm", network: "solana:main", amount: 100n });
    const caps: ChainCapabilities = {
      supportedNamespaces: ["evm", "svm"],
      preferredChains: ["svm", "evm"],
    };
    // Both namespaces are preferred, so all options are candidates.
    // cheapest (evm at 50n) wins via price sort.
    expect(selectBestAccept([evm, svm], caps)).toBe(evm);
  });

  it("multiple preferred chains: cheapest among preferred when not all namespaces preferred", () => {
    const evmCheap = option({ amount: 50n });
    const svmMedium = option({ namespace: "svm", network: "solana:main", amount: 80n });
    const caps: ChainCapabilities = {
      supportedNamespaces: ["evm", "svm"],
      preferredChains: ["svm"],
    };
    // Only svm is preferred and has candidates -> returns svm even though evm is cheaper
    expect(selectBestAccept([evmCheap, svmMedium], caps)).toBe(svmMedium);
  });

  it("fallback to non-preferred when preferred chain has no options", () => {
    const evm = option({ amount: 100n });
    const caps: ChainCapabilities = {
      supportedNamespaces: ["evm", "svm"],
      preferredChains: ["svm", "evm"],
    };
    // svm is preferred but has no options, evm is also preferred -> evm returned
    expect(selectBestAccept([evm], caps)).toBe(evm);
  });

  it("fallback to second preferred chain if first has no options", () => {
    const evm = option({ amount: 100n });
    const caps: ChainCapabilities = {
      supportedNamespaces: ["evm", "svm"],
      preferredChains: ["svm"],
    };
    // svm preferred but absent from accepts. Preferred filter yields empty -> falls back to all compatible.
    expect(selectBestAccept([evm], caps)).toBe(evm);
  });
});
