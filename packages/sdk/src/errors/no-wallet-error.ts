import { BoltzPayError } from "./boltzpay-error";

export class NoWalletError extends BoltzPayError {
  readonly code = "no_wallet_available" as const;
  readonly statusCode = 424;
  readonly requestedNetwork: string;
  readonly availableNetworks: string[];

  constructor(requestedNetwork: string, availableNetworks: string[]) {
    super(
      `No wallet configured for network "${requestedNetwork}". ` +
        `Available networks: [${availableNetworks.join(", ")}]`,
    );
    this.requestedNetwork = requestedNetwork;
    this.availableNetworks = availableNetworks;
  }
}
