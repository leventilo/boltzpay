import type { ICredentialType, INodeProperties } from "n8n-workflow";

export class BoltzPayApi implements ICredentialType {
  name = "boltzPayApi";
  displayName = "BoltzPay API";
  documentationUrl = "https://docs.boltzpay.ai";

  properties: INodeProperties[] = [
    {
      displayName: "API Key ID",
      name: "apiKeyId",
      type: "string",
      default: "",
      required: true,
      description: "Coinbase CDP API Key ID",
    },
    {
      displayName: "API Key Secret",
      name: "apiKeySecret",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description: "Coinbase CDP API Key Secret",
    },
    {
      displayName: "Wallet Secret",
      name: "walletSecret",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description: "Coinbase CDP Wallet Secret for signing transactions",
    },
  ];
}
