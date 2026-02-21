import type { AcceptOption, ChainCapabilities } from "./chain-types";
import { NoCompatibleChainError } from "./payment-errors";

const NAMESPACE_TIE_BREAK_ORDER: Record<string, number> = {
  evm: 0,
  svm: 1,
};

/** Select the cheapest compatible accept option, preferring preferred chains. */
function selectBestAccept(
  accepts: readonly AcceptOption[],
  capabilities: ChainCapabilities,
): AcceptOption {
  const supported = new Set(capabilities.supportedNamespaces);

  const compatible = accepts.filter((opt) => supported.has(opt.namespace));

  if (compatible.length === 0) {
    const wanted = [...new Set(accepts.map((opt) => opt.namespace))];
    throw new NoCompatibleChainError(wanted, [...supported]);
  }

  let candidates = compatible;

  if (capabilities.preferredChains.length > 0) {
    const preferred = new Set(capabilities.preferredChains);
    const preferredCandidates = compatible.filter((opt) =>
      preferred.has(opt.namespace),
    );
    if (preferredCandidates.length > 0) {
      candidates = preferredCandidates;
    }
  }

  const sorted = [...candidates].sort((a, b) => {
    if (a.amount < b.amount) return -1;
    if (a.amount > b.amount) return 1;
    const aOrder = NAMESPACE_TIE_BREAK_ORDER[a.namespace] ?? 99;
    const bOrder = NAMESPACE_TIE_BREAK_ORDER[b.namespace] ?? 99;
    return aOrder - bOrder;
  });

  const best = sorted[0];
  if (!best) {
    throw new NoCompatibleChainError([], [...supported]);
  }
  return best;
}

export { selectBestAccept };
