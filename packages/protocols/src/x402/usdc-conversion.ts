const ATOMIC_PER_CENT = 10_000n;
const MINIMUM_CENTS = 1n;

export function usdcAtomicToCents(atomicUnits: bigint): bigint {
  if (atomicUnits < 0n) {
    throw new Error("Atomic units cannot be negative");
  }
  if (atomicUnits === 0n) return 0n;
  const cents = (atomicUnits + ATOMIC_PER_CENT - 1n) / ATOMIC_PER_CENT;
  return cents < MINIMUM_CENTS ? MINIMUM_CENTS : cents;
}

export function centsToUsdcAtomic(cents: bigint): bigint {
  if (cents < 0n) {
    throw new Error("Cents cannot be negative");
  }
  return cents * ATOMIC_PER_CENT;
}
