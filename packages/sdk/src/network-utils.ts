const NETWORK_DISPLAY_NAMES: Record<string, string> = {
  "eip155:8453": "Base",
  "eip155:84532": "Base Sepolia",
  "eip155:1": "Ethereum",
  "eip155:11155111": "Ethereum Sepolia",
};

const EVM_TESTNET_CHAIN_IDS = new Set(["84532", "11155111", "421614", "80002"]);

const SOLANA_DEVNET_GENESIS = new Set(["EtWTRABZaYq6iMfeYKouRu166VU2xqa1"]);

const EIP155_PREFIX = "eip155:";
const SOLANA_PREFIX = "solana:";

/** Map a CAIP-2 network string to a human-readable display name. */
export function networkToShortName(network: string | undefined): string {
  if (!network) return "\u2014";
  const known = NETWORK_DISPLAY_NAMES[network];
  if (known) return known;
  if (network.startsWith(EIP155_PREFIX)) return "EVM";
  if (network.startsWith(SOLANA_PREFIX)) {
    const genesis = network.slice(SOLANA_PREFIX.length);
    if (SOLANA_DEVNET_GENESIS.has(genesis)) return "Solana Devnet";
    return "Solana";
  }
  return network;
}

/** Detect whether a network identifier refers to a testnet/devnet. */
export function isTestnet(network: string | undefined): boolean {
  if (!network) return false;
  if (network.startsWith(EIP155_PREFIX)) {
    return EVM_TESTNET_CHAIN_IDS.has(network.slice(EIP155_PREFIX.length));
  }
  if (network.startsWith(SOLANA_PREFIX)) {
    return SOLANA_DEVNET_GENESIS.has(network.slice(SOLANA_PREFIX.length));
  }
  return (
    network.includes("sepolia") ||
    network.includes("devnet") ||
    network.includes("testnet")
  );
}
