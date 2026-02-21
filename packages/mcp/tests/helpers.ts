import type { BoltzPay } from "@boltzpay/sdk";
import { Money } from "@boltzpay/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { vi } from "vitest";

type MockBoltzPay = {
  [K in keyof BoltzPay]: BoltzPay[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : BoltzPay[K];
};

export function createMockSdk(): MockBoltzPay & BoltzPay {
  const mock: MockBoltzPay = {
    fetch: vi.fn(),
    quote: vi.fn(),
    getBudget: vi.fn().mockReturnValue({
      dailySpent: Money.zero(),
      monthlySpent: Money.zero(),
      dailyLimit: undefined,
      monthlyLimit: undefined,
      perTransactionLimit: undefined,
      dailyRemaining: undefined,
      monthlyRemaining: undefined,
    }),
    getCapabilities: vi.fn().mockReturnValue({
      network: "base",
      protocols: ["x402"],
      chains: ["evm", "svm"],
      addresses: { evm: undefined, svm: undefined },
    }),
    getBalances: vi.fn().mockResolvedValue({}),
    getWalletStatus: vi.fn().mockResolvedValue({
      network: "base",
      isTestnet: false,
      protocols: ["x402"],
      canPay: false,
      credentials: {
        coinbase: { configured: false, keyHint: undefined },
      },
      connection: { status: "skipped", reason: "Coinbase credentials not configured" },
      accounts: { evm: undefined, svm: undefined },
      budget: {
        dailySpent: Money.zero(),
        monthlySpent: Money.zero(),
        dailyLimit: undefined,
        monthlyLimit: undefined,
        perTransactionLimit: undefined,
        dailyRemaining: undefined,
        monthlyRemaining: undefined,
      },
    }),
    getHistory: vi.fn().mockReturnValue([]),
    discover: vi.fn().mockResolvedValue([]),
    on: vi.fn().mockReturnThis(),
    resetDailyBudget: vi.fn(),
  };
  // Cast justified: MockBoltzPay satisfies the BoltzPay interface shape via vi.fn() mocks
  return mock as MockBoltzPay & BoltzPay;
}

export async function createTestClient(
  setupServer: (server: McpServer) => void,
): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = new McpServer({ name: "test-boltzpay", version: "0.1.0" });
  setupServer(server);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}
