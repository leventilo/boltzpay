import { BoltzPay as BoltzPaySdk, filterDirectory, Money } from "@boltzpay/sdk";
import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

/**
 * Credentials shape returned by n8n's getCredentials().
 * Fields match BoltzPayApi.credentials.ts property names.
 */
interface BoltzPayCredentials {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
}

/** Parameters extracted from n8n node UI for a single item. */
export interface OperationParams {
  operation: string;
  url?: string;
  method?: string;
  chain?: string;
  category?: string;
}

/**
 * Execute a single operation against the SDK.
 * Extracted as a standalone function for testability — n8n's IExecuteFunctions
 * is complex to mock, but this function only depends on the SDK instance.
 */
export async function executeOperation(
  sdk: BoltzPaySdk,
  params: OperationParams,
): Promise<IDataObject[]> {
  switch (params.operation) {
    case "fetch": {
      const url = params.url;
      if (!url) throw new Error("URL is required for fetch operation");
      const chain = params.chain === "auto" ? undefined : params.chain;
      const response = await sdk.fetch(url, {
        method: params.method ?? "GET",
        chain: chain as "evm" | "svm" | undefined,
      });
      const body = await response.text();
      return [
        {
          status: response.status,
          body,
          payment: response.payment
            ? {
                protocol: response.payment.protocol,
                amount: response.payment.amount.toDisplayString(),
                url: response.payment.url,
                txHash: response.payment.txHash ?? null,
              }
            : null,
        },
      ];
    }

    case "check": {
      const url = params.url;
      if (!url) throw new Error("URL is required for check operation");
      try {
        const quote = await sdk.quote(url);
        return [
          {
            isPaid: true,
            protocol: quote.protocol,
            amount: quote.amount.toDisplayString(),
            network: quote.network ?? null,
          },
        ];
      } catch {
        // No protocol detected or network error — endpoint is free or unreachable
        return [{ isPaid: false }];
      }
    }

    case "quote": {
      const url = params.url;
      if (!url) throw new Error("URL is required for quote operation");
      const quote = await sdk.quote(url);
      return [
        {
          protocol: quote.protocol,
          amount: quote.amount.toDisplayString(),
          network: quote.network ?? null,
          allAccepts: quote.allAccepts
            ? quote.allAccepts.map((a) => ({
                network: a.network,
                amount: Money.fromCents(a.amount).toDisplayString(),
              }))
            : null,
        },
      ];
    }

    case "discover": {
      const entries = filterDirectory(params.category);
      return entries.map((entry) => ({
        name: entry.name,
        url: entry.url,
        protocol: entry.protocol,
        category: entry.category,
        description: entry.description,
        pricing: entry.pricing,
      }));
    }

    default:
      throw new Error(`Unknown operation: ${params.operation}`);
  }
}

/**
 * Create a BoltzPay SDK instance from optional credentials.
 * Returns an unconfigured SDK (no payment capability) when credentials are null.
 */
export function createSdkFromCredentials(
  credentials: BoltzPayCredentials | null,
): BoltzPaySdk {
  if (credentials) {
    return new BoltzPaySdk({
      coinbaseApiKeyId: credentials.apiKeyId,
      coinbaseApiKeySecret: credentials.apiKeySecret,
      coinbaseWalletSecret: credentials.walletSecret,
    });
  }
  return new BoltzPaySdk({});
}

function extractParams(ctx: IExecuteFunctions, i: number): OperationParams {
  const operation = ctx.getNodeParameter("operation", i) as string;
  const params: OperationParams = { operation };

  if (operation === "fetch" || operation === "check" || operation === "quote") {
    params.url = ctx.getNodeParameter("url", i) as string;
  }

  if (operation === "fetch") {
    params.method = ctx.getNodeParameter("method", i) as string;
    params.chain = ctx.getNodeParameter("chain", i) as string;
  }

  if (operation === "discover") {
    const category = ctx.getNodeParameter("category", i) as string;
    if (category) params.category = category;
  }

  return params;
}

export class BoltzPay implements INodeType {
  description: INodeTypeDescription = {
    displayName: "BoltzPay",
    name: "boltzPay",
    icon: "file:boltzpay.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: "Fetch data from paid APIs via x402/L402 protocols",
    defaults: {
      name: "BoltzPay",
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "boltzPayApi",
        required: false,
      },
    ],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Fetch",
            value: "fetch",
            description: "Fetch and pay for API data",
            action: "Fetch and pay for API data",
          },
          {
            name: "Check",
            value: "check",
            description: "Check if URL requires payment",
            action: "Check if URL requires payment",
          },
          {
            name: "Quote",
            value: "quote",
            description: "Get price quote for URL",
            action: "Get price quote for URL",
          },
          {
            name: "Discover",
            value: "discover",
            description: "Browse compatible API directory",
            action: "Browse compatible API directory",
          },
        ],
        default: "fetch",
      },
      {
        displayName: "URL",
        name: "url",
        type: "string",
        default: "",
        required: true,
        displayOptions: {
          show: {
            operation: ["fetch", "check", "quote"],
          },
        },
        description: "The API URL to interact with",
      },
      {
        displayName: "HTTP Method",
        name: "method",
        type: "options",
        options: [
          { name: "GET", value: "GET" },
          { name: "POST", value: "POST" },
          { name: "PUT", value: "PUT" },
        ],
        default: "GET",
        displayOptions: {
          show: {
            operation: ["fetch"],
          },
        },
        description: "HTTP method for the request",
      },
      {
        displayName: "Chain",
        name: "chain",
        type: "options",
        options: [
          {
            name: "Auto",
            value: "auto",
            description: "Automatically select the best chain",
          },
          {
            name: "EVM (Base)",
            value: "evm",
            description: "Use Base (EVM) chain",
          },
          {
            name: "SVM (Solana)",
            value: "svm",
            description: "Use Solana chain",
          },
        ],
        default: "auto",
        displayOptions: {
          show: {
            operation: ["fetch"],
          },
        },
        description: "Blockchain to use for payment",
      },
      {
        displayName: "Category",
        name: "category",
        type: "string",
        default: "",
        displayOptions: {
          show: {
            operation: ["discover"],
          },
        },
        description:
          "Filter API directory by category (e.g. crypto-data, utilities, demo)",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // n8n getCredentials returns unknown — cast justified by n8n framework contract
    const credentials = (await this.getCredentials("boltzPayApi").catch(
      () => null,
    )) as BoltzPayCredentials | null;
    const sdk = createSdkFromCredentials(credentials);

    for (let i = 0; i < items.length; i++) {
      try {
        // n8n getNodeParameter() returns NodeParameterValueType — casts justified by n8n framework contract
        const params = extractParams(this, i);
        const results = await executeOperation(sdk, params);
        for (const result of results) {
          returnData.push({ json: result });
        }
      } catch (error) {
        if (!this.continueOnFail()) throw error;
        returnData.push({
          json: {
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    }

    return [returnData];
  }
}
