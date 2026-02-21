import type { BoltzPay } from "@boltzpay/sdk";
import { tool } from "ai";
import { z } from "zod";

export function createWalletTool(sdk: BoltzPay) {
  return tool({
    description:
      "View wallet info, supported protocols, chains, and balances. Shows whether the SDK can make payments (requires Coinbase credentials) and wallet addresses for Base (EVM) and Solana (SVM).",
    inputSchema: z.object({}),
    execute: async (_input, { abortSignal }) => {
      abortSignal?.throwIfAborted();
      const capabilities = sdk.getCapabilities();
      const balances: {
        evm?: { address: string; balance: string | undefined };
        svm?: { address: string; balance: string | undefined };
      } = {};

      if (capabilities.canPay) {
        try {
          const raw = await sdk.getBalances();
          if (raw.evm) {
            balances.evm = {
              address: raw.evm.address,
              balance: raw.evm.balance?.toDisplayString(),
            };
          }
          if (raw.svm) {
            balances.svm = {
              address: raw.svm.address,
              balance: raw.svm.balance?.toDisplayString(),
            };
          }
        } catch {
          // Graceful degradation: balance fetching is best-effort
        }
      }

      return {
        network: capabilities.network,
        protocols: capabilities.protocols,
        canPay: capabilities.canPay,
        chains: capabilities.chains,
        addresses: capabilities.addresses,
        balances,
      };
    },
  });
}
