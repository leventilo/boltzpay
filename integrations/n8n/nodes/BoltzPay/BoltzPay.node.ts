import type { DiagnoseResult } from "@boltzpay/sdk";
import {
  BoltzPay as BoltzPaySdk,
  filterDirectory,
  Money,
  networkToShortName,
} from "@boltzpay/sdk";
import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

interface BoltzPayCredentials {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
}

export interface OperationParams {
  operation: string;
  url?: string;
  method?: string;
  chain?: string;
  category?: string;
}

function formatDiagnoseResult(result: DiagnoseResult): IDataObject {
  const output: IDataObject = {
    url: result.url,
    classification: result.classification,
    isPaid: result.isPaid,
    health: result.health,
    latencyMs: result.latencyMs,
  };

  if (result.protocol) output.protocol = result.protocol;
  if (result.formatVersion) output.formatVersion = result.formatVersion;
  if (result.scheme) output.scheme = result.scheme;
  if (result.network) output.network = result.network;
  if (result.price) output.price = result.price.toDisplayString();
  if (result.facilitator) output.facilitator = result.facilitator;
  if (result.deathReason) output.deathReason = result.deathReason;
  if (result.httpStatus != null) output.httpStatus = result.httpStatus;
  if (result.postOnly) output.postOnly = true;
  if (result.chains && result.chains.length > 0) {
    output.chains = result.chains.map((c) => ({
      namespace: c.namespace,
      network: c.network,
      price: c.price.toDisplayString(),
      scheme: c.scheme,
    }));
  }
  if (result.timing) output.timing = result.timing as unknown as IDataObject;

  return output;
}

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

    case "diagnose": {
      const url = params.url;
      if (!url) throw new Error("URL is required for diagnose operation");
      try {
        const result = await sdk.diagnose(url);
        return [formatDiagnoseResult(result)];
      } catch (error) {
        return [
          {
            url,
            error: error instanceof Error ? error.message : "Diagnosis failed",
          },
        ];
      }
    }

    case "budget": {
      const state = sdk.getBudget();

      const hasBudget =
        state.dailyLimit !== undefined ||
        state.monthlyLimit !== undefined ||
        state.perTransactionLimit !== undefined;

      if (!hasBudget) {
        return [{ configured: false }];
      }

      const result: IDataObject = { configured: true };

      if (state.dailyLimit) {
        result.daily = {
          limit: state.dailyLimit.toDisplayString(),
          spent: state.dailySpent.toDisplayString(),
          remaining: state.dailyRemaining?.toDisplayString() ?? "$0.00",
        };
      }

      if (state.monthlyLimit) {
        result.monthly = {
          limit: state.monthlyLimit.toDisplayString(),
          spent: state.monthlySpent.toDisplayString(),
          remaining: state.monthlyRemaining?.toDisplayString() ?? "$0.00",
        };
      }

      if (state.perTransactionLimit) {
        result.perTransaction = {
          limit: state.perTransactionLimit.toDisplayString(),
        };
      }

      return [result];
    }

    case "history": {
      const records = sdk.getHistory();

      if (records.length === 0) {
        return [{ payments: [], count: 0 }];
      }

      return records.map((record) => ({
        url: record.url,
        protocol: record.protocol,
        amount: record.amount.toDisplayString(),
        chain: networkToShortName(record.network),
        network: record.network ?? null,
        timestamp: record.timestamp.toISOString(),
        txHash: record.txHash ?? null,
      }));
    }

    case "wallet": {
      const status = await sdk.getWalletStatus();
      return [
        {
          network: status.network,
          isTestnet: status.isTestnet,
          protocols: status.protocols,
          canPay: status.canPay,
          credentials: status.credentials as unknown as IDataObject,
          connection: status.connection as unknown as IDataObject,
          accounts: {
            evm: status.accounts.evm
              ? {
                  address: status.accounts.evm.address,
                  balance:
                    status.accounts.evm.balance?.toDisplayString() ?? null,
                }
              : null,
            svm: status.accounts.svm
              ? {
                  address: status.accounts.svm.address,
                  balance:
                    status.accounts.svm.balance?.toDisplayString() ?? null,
                }
              : null,
          },
          budget: formatBudgetForWallet(sdk),
        },
      ];
    }

    default:
      throw new Error(`Unknown operation: ${params.operation}`);
  }
}

function formatBudgetForWallet(sdk: BoltzPaySdk): IDataObject {
  const budget = sdk.getBudget();
  const hasLimits =
    budget.dailyLimit || budget.monthlyLimit || budget.perTransactionLimit;

  if (!hasLimits) {
    return { configured: false };
  }

  const result: IDataObject = { configured: true };

  if (budget.dailyLimit) {
    result.daily = {
      limit: budget.dailyLimit.toDisplayString(),
      spent: budget.dailySpent.toDisplayString(),
      remaining: budget.dailyRemaining?.toDisplayString() ?? "$0.00",
    };
  }
  if (budget.monthlyLimit) {
    result.monthly = {
      limit: budget.monthlyLimit.toDisplayString(),
      spent: budget.monthlySpent.toDisplayString(),
      remaining: budget.monthlyRemaining?.toDisplayString() ?? "$0.00",
    };
  }
  if (budget.perTransactionLimit) {
    result.perTransaction = {
      limit: budget.perTransactionLimit.toDisplayString(),
    };
  }

  return result;
}

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

  if (
    operation === "fetch" ||
    operation === "check" ||
    operation === "quote" ||
    operation === "diagnose"
  ) {
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
          {
            name: "Diagnose",
            value: "diagnose",
            description:
              "Diagnose an API endpoint's payment protocol, health, and latency",
            action:
              "Diagnose an API endpoint's payment protocol, health, and latency",
          },
          {
            name: "Budget",
            value: "budget",
            description: "View current spending budget status",
            action: "View current spending budget status",
          },
          {
            name: "History",
            value: "history",
            description: "List recent payments made during session",
            action: "List recent payments made during session",
          },
          {
            name: "Wallet",
            value: "wallet",
            description: "Check wallet connectivity, credentials, and balances",
            action: "Check wallet connectivity, credentials, and balances",
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
            operation: ["fetch", "check", "quote", "diagnose"],
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

    const credentials = (await this.getCredentials("boltzPayApi").catch(
      () => null,
    )) as BoltzPayCredentials | null;
    const sdk = createSdkFromCredentials(credentials);

    for (let i = 0; i < items.length; i++) {
      try {
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
