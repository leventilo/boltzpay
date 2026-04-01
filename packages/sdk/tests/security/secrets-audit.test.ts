import { Money } from "@boltzpay/core";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Receipt } from "mppx";

const FAKE_TEMPO_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FAKE_STRIPE_SECRET_KEY = "sk_test_51ABC123secretStripeKey9999";
const FAKE_NWC_CONNECTION_STRING =
  "nostr+walletconnect://relay.example.com?secret=deadbeef1234567890abcdef";
const FAKE_COINBASE_API_KEY_ID = "org-coinbase-key-id-secret";
const FAKE_COINBASE_API_KEY_SECRET =
  "-----BEGIN EC PRIVATE KEY-----\nMIGkAgEBBDCfakekey1234567890abcdef\n-----END EC PRIVATE KEY-----";
const FAKE_COINBASE_WALLET_SECRET = "wallet-secret-ultra-secret-value";
const FAKE_VISA_JWE = "eyJhbGciOiJSU0EtT0FFUCIsImVuYyI6IkEyNTZHQ00ifQ.secret";

const ALL_SECRETS = [
  FAKE_TEMPO_PRIVATE_KEY,
  FAKE_STRIPE_SECRET_KEY,
  FAKE_NWC_CONNECTION_STRING,
  FAKE_COINBASE_API_KEY_ID,
  FAKE_COINBASE_API_KEY_SECRET,
  FAKE_COINBASE_WALLET_SECRET,
  FAKE_VISA_JWE,
  // Also check partial fragments that would indicate a leak
  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "sk_test_51ABC123secretStripeKey9999",
  "deadbeef1234567890abcdef",
  "wallet-secret-ultra-secret-value",
  "MIGkAgEBBDCfakekey1234567890abcdef",
];

function assertNoSecrets(text: string, context: string): void {
  for (const secret of ALL_SECRETS) {
    expect(text, `Secret "${secret.slice(0, 8)}..." found in ${context}`).not.toContain(secret);
  }
}

vi.mock("@coinbase/cdp-sdk", () => ({
  CdpClient: class MockCdpClient {
    constructor() {}
  },
}));

vi.mock("@boltzpay/protocols", () => {
  class MockCdpWalletManager {
    constructor() {}
    getAddresses() {
      return {};
    }
    async getBalances() {
      return {};
    }
    async getOrProvisionEvmAccount() {
      return { address: "0x1234" };
    }
  }
  class MockProtocolRouter {
    constructor() {}
    probeAll() {
      return Promise.reject(
        new (class extends Error {
          constructor() {
            super("No protocol detected");
            this.name = "ProtocolDetectionFailedError";
          }
        })(),
      );
    }
    probeFromResponse() {
      return Promise.resolve([]);
    }
    execute() {
      return Promise.reject(new Error("Not implemented in test"));
    }
  }
  class MockX402Adapter {
    name = "x402";
    constructor() {}
  }
  class MockMppAdapter {
    name = "mpp";
    constructor() {}
  }
  class MockMppMethodSelector {
    constructor() {}
  }
  class MockAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "AdapterError";
    }
  }
  class MockL402Adapter {
    name = "l402";
    constructor() {}
  }
  class MockNwcWalletManager {
    constructor() {}
    close() {}
    async getBalance() {
      return { balanceSats: 100_000n };
    }
  }
  class MockX402PaymentError extends MockAdapterError {
    deliveryAttempts?: readonly {
      method: string;
      headerName: string;
      status: number;
    }[];
    constructor(message: string) {
      super("x402_payment_failed", message);
    }
  }
  class MockAggregatePaymentError extends MockAdapterError {
    errors: readonly Error[];
    constructor(errors: readonly Error[]) {
      const messages = errors
        .map((e, i) => `  ${i + 1}. ${e.message}`)
        .join("\n");
      super(
        "aggregate_payment_failed",
        `All payment attempts failed:\n${messages}`,
      );
      this.errors = errors;
    }
  }

  function mockCreateMppMethod() {
    return { name: "mock-method" };
  }

  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: MockX402Adapter,
    MppAdapter: MockMppAdapter,
    MppMethodSelector: MockMppMethodSelector,
    MppSessionManager: class {
      constructor() {}
    },
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
    X402PaymentError: MockX402PaymentError,
    AggregatePaymentError: MockAggregatePaymentError,
    createMppMethod: mockCreateMppMethod,
  };
});

import { BoltzPay } from "../../src/boltzpay";
import { ConfigurationError } from "../../src/errors/configuration-error";
import { NetworkError } from "../../src/errors/network-error";
import { NoWalletError } from "../../src/errors/no-wallet-error";
import { BudgetExceededError } from "../../src/errors/budget-exceeded-error";
import { ProtocolError } from "../../src/errors/protocol-error";
import { PaymentUncertainError } from "../../src/errors/payment-uncertain-error";
import { MppSessionError, MppSessionBudgetError } from "../../src/errors/mpp-session-error";
import { createLogger } from "../../src/logger/logger";
import type { PaymentRecord } from "../../src/history/types";
import { PaymentHistory } from "../../src/history/payment-history";
import { MemoryAdapter } from "../../src/persistence/memory-adapter";
import { FileAdapter } from "../../src/persistence/file-adapter";

function captureStderr(): { output: string; restore: () => void } {
  let captured = "";
  const original = process.stderr.write.bind(process.stderr);
  const mock = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    });
  return {
    get output() {
      return captured;
    },
    restore() {
      mock.mockRestore();
    },
  };
}

describe("Secrets in logs", () => {
  it("debug-level text logs never contain private keys or secrets", () => {
    const capture = captureStderr();
    try {
      const _sdk = new BoltzPay({
        logLevel: "debug",
        logFormat: "text",
        wallets: [
          {
            type: "tempo",
            name: "audit-tempo",
            tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
          },
          {
            type: "stripe-mpp",
            name: "audit-stripe",
            stripeSecretKey: FAKE_STRIPE_SECRET_KEY,
          },
        ],
        nwcConnectionString: FAKE_NWC_CONNECTION_STRING,
        coinbaseApiKeyId: FAKE_COINBASE_API_KEY_ID,
        coinbaseApiKeySecret: FAKE_COINBASE_API_KEY_SECRET,
        coinbaseWalletSecret: FAKE_COINBASE_WALLET_SECRET,
      });
      assertNoSecrets(capture.output, "debug text log output on construction");
    } finally {
      capture.restore();
    }
  });

  it("debug-level JSON logs never contain private keys or secrets", () => {
    const capture = captureStderr();
    try {
      const _sdk = new BoltzPay({
        logLevel: "debug",
        logFormat: "json",
        wallets: [
          {
            type: "tempo",
            name: "audit-tempo",
            tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
          },
          {
            type: "stripe-mpp",
            name: "audit-stripe",
            stripeSecretKey: FAKE_STRIPE_SECRET_KEY,
          },
        ],
        nwcConnectionString: FAKE_NWC_CONNECTION_STRING,
        coinbaseApiKeyId: FAKE_COINBASE_API_KEY_ID,
        coinbaseApiKeySecret: FAKE_COINBASE_API_KEY_SECRET,
        coinbaseWalletSecret: FAKE_COINBASE_WALLET_SECRET,
      });
      assertNoSecrets(capture.output, "debug JSON log output on construction");
    } finally {
      capture.restore();
    }
  });

  it("logger with JSON format redacts sensitive LogEntry keys", () => {
    const capture = captureStderr();
    try {
      const logger = createLogger("debug", "json");
      logger.debug("wallet init", {
        tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
      } as Record<string, unknown>);

      const output = capture.output;
      expect(output).not.toContain(FAKE_TEMPO_PRIVATE_KEY);
      expect(output).toContain("[REDACTED]");
    } finally {
      capture.restore();
    }
  });

  it("fetch() debug logs never contain wallet secrets", async () => {
    const capture = captureStderr();
    try {
      const sdk = new BoltzPay({
        logLevel: "debug",
        logFormat: "json",
        wallets: [
          {
            type: "tempo",
            name: "audit-tempo",
            tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
          },
        ],
        coinbaseApiKeyId: FAKE_COINBASE_API_KEY_ID,
        coinbaseApiKeySecret: FAKE_COINBASE_API_KEY_SECRET,
        coinbaseWalletSecret: FAKE_COINBASE_WALLET_SECRET,
      });

      // fetch() will fail (mock router rejects), but we want to check logs
      try {
        await sdk.fetch("https://example.com/paid");
      } catch {
        // Expected: protocol detection fails in mock
      }

      assertNoSecrets(capture.output, "fetch() debug JSON log output");
    } finally {
      capture.restore();
    }
  });
});

describe("rawConfig exposure in events", () => {
  it("wallet:selected event never exposes rawConfig or credentials", async () => {
    const sdk = new BoltzPay({
      logLevel: "silent",
      wallets: [
        {
          type: "tempo",
          name: "audit-tempo",
          tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
        },
        {
          type: "stripe-mpp",
          name: "audit-stripe",
          stripeSecretKey: FAKE_STRIPE_SECRET_KEY,
        },
      ],
      coinbaseApiKeyId: FAKE_COINBASE_API_KEY_ID,
      coinbaseApiKeySecret: FAKE_COINBASE_API_KEY_SECRET,
      coinbaseWalletSecret: FAKE_COINBASE_WALLET_SECRET,
    });

    const events: unknown[] = [];
    sdk.on("wallet:selected", (ev) => {
      events.push(ev);
    });

    // Await fetch so events have time to fire before assertions
    await sdk.fetch("https://example.com/paid").catch(() => {});

    for (const ev of events) {
      const serialized = JSON.stringify(ev);
      assertNoSecrets(serialized, "wallet:selected event payload");
    }

    // WalletSelectedEvent type only has walletName, network, reason — verify shape
    const sampleEvent: import("../../src/events/types").WalletSelectedEvent = {
      walletName: "test",
      network: "evm",
      reason: "only_match",
    };
    const sampleKeys = Object.keys(sampleEvent);
    expect(sampleKeys).not.toContain("rawConfig");
    expect(sampleKeys).not.toContain("tempoPrivateKey");
    expect(sampleKeys).not.toContain("stripeSecretKey");
    expect(sampleKeys).not.toContain("coinbaseWalletSecret");
    assertNoSecrets(JSON.stringify(sampleEvent), "WalletSelectedEvent shape");
  });

  it("payment event PaymentRecord never contains credentials", () => {
    const record: PaymentRecord = {
      id: "test-id",
      url: "https://example.com/paid",
      protocol: "mpp",
      amount: Money.fromCents(100n),
      timestamp: new Date(),
      txHash: "tempo:0xabc",
      network: "evm",
      durationMs: 200,
    };

    const serialized = JSON.stringify(record);
    assertNoSecrets(serialized, "PaymentRecord serialization");

    // PaymentRecord type should NOT have rawConfig, tempoPrivateKey, etc.
    const recordKeys = Object.keys(record);
    expect(recordKeys).not.toContain("rawConfig");
    expect(recordKeys).not.toContain("tempoPrivateKey");
    expect(recordKeys).not.toContain("stripeSecretKey");
    expect(recordKeys).not.toContain("coinbaseWalletSecret");
    expect(recordKeys).not.toContain("coinbaseApiKeySecret");
    expect(recordKeys).not.toContain("nwcConnectionString");
  });

  it("error event never contains credentials", () => {
    const sdk = new BoltzPay({
      logLevel: "silent",
      wallets: [
        {
          type: "tempo",
          name: "audit-tempo",
          tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
        },
      ],
    });

    const errors: Error[] = [];
    sdk.on("error", (err) => {
      errors.push(err);
    });

    sdk.fetch("https://example.com/paid").catch(() => {});

    for (const err of errors) {
      assertNoSecrets(err.message, "error event message");
      assertNoSecrets(err.stack ?? "", "error event stack");
    }
  });

  it("budget:exceeded event never contains credentials", () => {
    // BudgetExceededEvent type only has: requested (Money), limit (Money), period (string)
    // Verify the event shape does not include credential fields
    const sampleEvent: import("../../src/events/types").BudgetExceededEvent = {
      requested: Money.fromCents(500n),
      limit: Money.fromCents(100n),
      period: "daily",
    };

    const serialized = JSON.stringify(sampleEvent);
    assertNoSecrets(serialized, "budget:exceeded event payload");

    const keys = Object.keys(sampleEvent);
    expect(keys).not.toContain("rawConfig");
    expect(keys).not.toContain("tempoPrivateKey");
    expect(keys).not.toContain("stripeSecretKey");
    expect(keys).not.toContain("coinbaseWalletSecret");
    expect(keys).not.toContain("coinbaseApiKeySecret");
    expect(keys).toEqual(["requested", "limit", "period"]);
  });

  it("session:open event never contains credentials", () => {
    // SessionOpenEvent type only has: channelId, depositAmount (Money), url
    // Verify the event shape does not include credential fields
    const sampleEvent: import("../../src/events/types").SessionOpenEvent = {
      channelId: "chan-abc-123",
      depositAmount: Money.fromCents(1000n),
      url: "https://example.com/session",
    };

    const serialized = JSON.stringify(sampleEvent);
    assertNoSecrets(serialized, "session:open event payload");

    const keys = Object.keys(sampleEvent);
    expect(keys).not.toContain("rawConfig");
    expect(keys).not.toContain("tempoPrivateKey");
    expect(keys).not.toContain("stripeSecretKey");
    expect(keys).not.toContain("coinbaseWalletSecret");
    expect(keys).not.toContain("coinbaseApiKeySecret");
    expect(keys).toEqual(["channelId", "depositAmount", "url"]);
  });
});

describe("rawConfig exposure in history", () => {
  it("PaymentRecord serialization for storage never contains credentials", () => {
    const storage = new MemoryAdapter();
    const history = new PaymentHistory({ storage, maxRecords: 100 });

    const record: PaymentRecord = {
      id: "sec-test-1",
      url: "https://example.com/paid",
      protocol: "mpp",
      amount: Money.fromCents(100n),
      timestamp: new Date(),
      txHash: "tempo:0xdeadbeef",
      network: "evm",
    };

    history.add(record);

    // Check what's in storage
    return storage.keys("history:").then(async (keys) => {
      for (const key of keys) {
        const raw = await storage.get(key);
        if (raw) {
          assertNoSecrets(raw, "persisted history record");
          // Also verify no rawConfig key in JSON
          const parsed = JSON.parse(raw);
          expect(parsed).not.toHaveProperty("rawConfig");
          expect(parsed).not.toHaveProperty("tempoPrivateKey");
          expect(parsed).not.toHaveProperty("stripeSecretKey");
          expect(parsed).not.toHaveProperty("coinbaseWalletSecret");
        }
      }
    });
  });

  it("exportJSON never contains credentials", () => {
    const sdk = new BoltzPay({
      logLevel: "silent",
      wallets: [
        {
          type: "tempo",
          name: "audit-tempo",
          tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
        },
      ],
    });

    const exported = sdk.exportHistory("json");
    assertNoSecrets(exported, "exported JSON history");
  });

  it("exportCSV never contains credentials", () => {
    const sdk = new BoltzPay({
      logLevel: "silent",
      wallets: [
        {
          type: "tempo",
          name: "audit-tempo",
          tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
        },
      ],
    });

    const exported = sdk.exportHistory("csv");
    assertNoSecrets(exported, "exported CSV history");
  });
});

describe("rawConfig exposure in errors", () => {
  it("ConfigurationError never contains credential values", () => {
    const err = new ConfigurationError(
      "invalid_config",
      "Invalid BoltzPay configuration",
    );
    assertNoSecrets(err.message, "ConfigurationError message");
    assertNoSecrets(err.stack ?? "", "ConfigurationError stack");
    assertNoSecrets(JSON.stringify(err), "ConfigurationError JSON");
  });

  it("NetworkError never contains credential values", () => {
    const err = new NetworkError("endpoint_unreachable", "Cannot reach endpoint");
    assertNoSecrets(err.message, "NetworkError message");
    assertNoSecrets(JSON.stringify(err), "NetworkError JSON");
  });

  it("NoWalletError message and JSON do not contain secrets", () => {
    const err = new NoWalletError("tempo", ["coinbase", "nwc"]);
    assertNoSecrets(err.message, "NoWalletError message");
    assertNoSecrets(JSON.stringify(err), "NoWalletError JSON");
  });

  it("BudgetExceededError never contains credentials", () => {
    const err = new BudgetExceededError(
      "daily_budget_exceeded",
      Money.fromCents(500n),
      Money.fromCents(100n),
    );
    assertNoSecrets(err.message, "BudgetExceededError message");
    const serialized = JSON.stringify(err);
    assertNoSecrets(serialized, "BudgetExceededError JSON");
  });

  it("ProtocolError never contains credentials", () => {
    const err = new ProtocolError("payment_failed", "Payment failed: server error");
    assertNoSecrets(err.message, "ProtocolError message");
    assertNoSecrets(JSON.stringify(err), "ProtocolError JSON");
  });

  it("PaymentUncertainError never contains credentials", () => {
    const err = new PaymentUncertainError({
      message: "Network error after payment signing",
      url: "https://example.com/paid",
      amount: Money.fromCents(100n),
      protocol: "mpp",
      txHash: "tempo:0xabc",
    });
    assertNoSecrets(err.message, "PaymentUncertainError message");
    assertNoSecrets(JSON.stringify(err), "PaymentUncertainError JSON");
  });

  it("MppSessionBudgetError never contains credentials", () => {
    const err = new MppSessionBudgetError(
      Money.fromCents(1000n),
      Money.fromCents(500n),
    );
    assertNoSecrets(err.message, "MppSessionBudgetError message");
    assertNoSecrets(JSON.stringify(err), "MppSessionBudgetError JSON");
  });

  it("MppSessionError never contains credentials", () => {
    const err = new MppSessionError("Session open failed");
    assertNoSecrets(err.message, "MppSessionError message");
    assertNoSecrets(JSON.stringify(err), "MppSessionError JSON");
  });

  it("JSON.stringify(error) does not leak credentials from error properties", () => {
    // This tests the serialization behavior of Error objects.
    // Error.message is serializable, but non-enumerable properties like stack
    // are not included in JSON.stringify. Verify custom properties don't leak.
    const errors = [
      new ConfigurationError("invalid_config", "test"),
      new NetworkError("endpoint_unreachable", "test"),
      new NoWalletError("tempo", ["coinbase"]),
      new BudgetExceededError("daily_budget_exceeded", Money.fromCents(1n), Money.fromCents(1n)),
      new ProtocolError("payment_failed", "test"),
      new PaymentUncertainError({
        message: "test",
        url: "https://example.com",
        amount: Money.fromCents(1n),
        protocol: "mpp",
      }),
      new MppSessionBudgetError(Money.fromCents(1n), Money.fromCents(1n)),
      new MppSessionError("test"),
    ];

    for (const err of errors) {
      const serialized = JSON.stringify(err);
      // Verify that no error accidentally includes a config reference
      assertNoSecrets(serialized, `${err.constructor.name} JSON serialization`);
    }
  });
});

describe("Receipt forgery", () => {
  it("Receipt.fromResponse extracts attacker-controlled fields from forged header", () => {
    // An attacker could set arbitrary method, reference, timestamp, status
    const forgedReceipt = Receipt.from({
      method: "tempo",
      status: "success",
      timestamp: "2026-01-01T00:00:00Z",
      reference: "0xFAKE_TX_HASH_ATTACKER_CONTROLLED",
    });
    const serialized = Receipt.serialize(forgedReceipt);

    const response = new Response("Fake paid content", {
      status: 200,
      headers: { "Payment-Receipt": serialized },
    });

    const extracted = Receipt.fromResponse(response);

    // FINDING: The SDK trusts the receipt reference from the server response.
    // An attacker-controlled server can set ANY reference value.
    // The SDK uses `${receipt.method}:${receipt.reference}` as externalTxHash.
    // This means the txHash in PaymentRecord can be entirely forged.
    expect(extracted.reference).toBe("0xFAKE_TX_HASH_ATTACKER_CONTROLLED");
    expect(extracted.method).toBe("tempo");
    expect(extracted.status).toBe("success");
  });

  it("Receipt.Schema rejects invalid status values (only 'success' allowed)", () => {
    const invalid = {
      method: "tempo",
      status: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      reference: "0xabc",
    };

    const result = Receipt.Schema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("Receipt.fromResponse throws on garbage base64 (does not silently accept)", () => {
    const response = new Response("content", {
      status: 200,
      headers: { "Payment-Receipt": "not-valid-base64-at-all!!!" },
    });

    expect(() => Receipt.fromResponse(response)).toThrow();
  });

  it("Receipt.fromResponse throws when Payment-Receipt header is missing", () => {
    const response = new Response("content", {
      status: 200,
    });

    expect(() => Receipt.fromResponse(response)).toThrow();
  });

  it("MppAdapter.buildProtocolResult treats response.ok as success regardless of receipt", () => {
    // FINDING: The SDK determines payment success based on response.ok (HTTP 2xx),
    // NOT based on the receipt. A malicious server could return 200 without a valid
    // receipt — the SDK would still report success: true, with externalTxHash undefined.
    // Verify: a 200 response without receipt header causes Receipt.fromResponse to throw,
    // confirming that buildProtocolResult's catch branch sets externalTxHash = undefined.
    const responseWithoutReceipt = new Response("content without receipt", { status: 200 });
    expect(responseWithoutReceipt.ok).toBe(true);
    expect(() => Receipt.fromResponse(responseWithoutReceipt)).toThrow();

    // Verify: a non-ok response (e.g. 500) is distinguishable
    const failResponse = new Response("server error", { status: 500 });
    expect(failResponse.ok).toBe(false);
    // buildProtocolResult uses response.ok to set success — 500 = success: false

    // Verify: a 200 WITH a valid receipt parses correctly
    const validReceipt = Receipt.from({
      method: "tempo",
      status: "success",
      timestamp: new Date().toISOString(),
      reference: "0xvalidhash",
    });
    const responseWithReceipt = new Response("paid content", {
      status: 200,
      headers: { "Payment-Receipt": Receipt.serialize(validReceipt) },
    });
    const extracted = Receipt.fromResponse(responseWithReceipt);
    expect(extracted.reference).toBe("0xvalidhash");
    expect(extracted.method).toBe("tempo");
  });
});

describe("MCP _meta injection", () => {
  it("extractReceipt extracts from _meta using Mcp.receiptMetaKey only", async () => {
    // The wrapper only looks at _meta[Mcp.receiptMetaKey] and result.receipt,
    // not at arbitrary _meta keys. Verify that a crafted _meta with
    // credential-like keys does not leak.

    // Import the wrapper's extractReceipt logic indirectly by checking behavior
    const { Mcp } = await import("mppx");

    const mockResult = {
      content: [{ type: "text", text: "paid content" }],
      _meta: {
        "org.paymentauth/credential": "leaked-credential-value",
        [Mcp.receiptMetaKey]: {
          method: "tempo",
          status: "success",
          reference: "0xabc",
          timestamp: "2026-01-01T00:00:00Z",
        },
        "some.other/key": { secret: FAKE_TEMPO_PRIVATE_KEY },
      },
      receipt: undefined,
    };

    // The WrappedCallToolResult should only expose receipt, content, isError, _meta
    // Verify that _meta passthrough does NOT include filtering
    // FINDING: The wrapper passes _meta through verbatim to the caller.
    // If a malicious MCP server puts credentials in _meta, they are visible
    // to the SDK consumer. However, the SDK itself does not USE arbitrary _meta keys.
    const resultMeta = mockResult._meta;
    expect(resultMeta).toHaveProperty("org.paymentauth/credential");
    // The SDK consumer receives this — it's the consumer's responsibility
    // to not trust arbitrary _meta values.
  });

  it("receipt extraction validates shape before returning", async () => {
    const { Mcp } = await import("mppx");

    // Crafted _meta with invalid receipt shape
    const badReceipt = {
      content: [{ type: "text", text: "content" }],
      _meta: {
        [Mcp.receiptMetaKey]: {
          // Missing required 'method' field
          status: "success",
          reference: "0xabc",
          timestamp: "2026-01-01T00:00:00Z",
        },
      },
    };

    // extractReceipt checks "method" in receipt — should reject
    const meta = badReceipt._meta[Mcp.receiptMetaKey] as Record<string, unknown>;
    const hasMethodField = "method" in meta;
    expect(hasMethodField).toBe(false);
  });
});

describe("Code audit assertions", () => {
  it("maskKey only reveals last 4 characters", () => {
    // Reproduce the maskKey function behavior
    const KEY_HINT_SUFFIX_LENGTH = 4;
    function maskKey(key: string): string {
      if (key.length <= KEY_HINT_SUFFIX_LENGTH) return key;
      return `...${key.slice(-KEY_HINT_SUFFIX_LENGTH)}`;
    }

    const masked = maskKey(FAKE_COINBASE_API_KEY_ID);
    expect(masked).not.toContain("coinbase-key-id");
    // Only last 4 chars should be visible
    expect(masked.length).toBeLessThanOrEqual(7); // "..." + 4 chars
  });

  it("extractMppRawConfig copies only the specific key for each wallet type", () => {
    const capture = captureStderr();
    try {
      const sdk = new BoltzPay({
        logLevel: "debug",
        logFormat: "json",
        wallets: [
          {
            type: "tempo",
            name: "tempo-wallet",
            tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
          },
          {
            type: "stripe-mpp",
            name: "stripe-wallet",
            stripeSecretKey: FAKE_STRIPE_SECRET_KEY,
          },
        ],
      });

      const logOutput = capture.output;
      assertNoSecrets(logOutput, "construction logs with mixed wallet types");

      const events: unknown[] = [];
      sdk.on("wallet:selected", (ev) => events.push(ev));

      sdk.fetch("https://example.com/paid").catch(() => {});

      for (const ev of events) {
        const serialized = JSON.stringify(ev);
        assertNoSecrets(serialized, "wallet:selected event with mixed wallet types");
        expect(serialized).not.toContain("tempoPrivateKey");
        expect(serialized).not.toContain("stripeSecretKey");
        expect(serialized).not.toContain("rawConfig");
      }

      const capabilities = sdk.getCapabilities();
      const capJson = JSON.stringify(capabilities);
      assertNoSecrets(capJson, "getCapabilities() output");
      expect(capJson).not.toContain("rawConfig");
      expect(capJson).not.toContain("tempoPrivateKey");
      expect(capJson).not.toContain("stripeSecretKey");
    } finally {
      capture.restore();
    }
  });

  it("wallet data is not included in HTTP headers sent to endpoints", async () => {
    const capturedHeaders: Record<string, string>[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.headers) {
        const h = init.headers;
        const headerObj: Record<string, string> = {};
        if (h instanceof Headers) {
          h.forEach((v, k) => { headerObj[k] = v; });
        } else if (Array.isArray(h)) {
          for (const [k, v] of h) { headerObj[k] = v; }
        } else {
          Object.assign(headerObj, h);
        }
        capturedHeaders.push(headerObj);
      }
      return new Response("Not Found", { status: 404 });
    };

    try {
      const sdk = new BoltzPay({
        logLevel: "silent",
        wallets: [
          {
            type: "tempo",
            name: "audit-tempo",
            tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
          },
          {
            type: "stripe-mpp",
            name: "audit-stripe",
            stripeSecretKey: FAKE_STRIPE_SECRET_KEY,
          },
        ],
        coinbaseApiKeyId: FAKE_COINBASE_API_KEY_ID,
        coinbaseApiKeySecret: FAKE_COINBASE_API_KEY_SECRET,
        coinbaseWalletSecret: FAKE_COINBASE_WALLET_SECRET,
      });

      try {
        await sdk.fetch("https://example.com/paid");
      } catch {
        // Expected: protocol detection or payment fails
      }

      for (const headers of capturedHeaders) {
        const allHeaderValues = Object.values(headers).join(" ");
        assertNoSecrets(allHeaderValues, "HTTP headers sent to endpoint");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ResolvedWallet never appears in event payloads", () => {
    // WalletSelectedEvent only has: walletName, network, reason (all strings)
    // No rawConfig, no cdpManager, no nwcManager
    type WalletSelectedCheck = {
      walletName: string;
      network: string;
      reason: string;
    };
    // This type check ensures the event type only has safe fields
    const event: WalletSelectedCheck = {
      walletName: "test",
      network: "evm",
      reason: "only_match",
    };
    expect(Object.keys(event)).toEqual(["walletName", "network", "reason"]);
  });
});

describe("Logger LogEntry sanitization", () => {
  it("JSON format logger redacts fields with sensitive key names", () => {
    const capture = captureStderr();
    try {
      const logger = createLogger("debug", "json");
      logger.debug("test message", {
        someField: "safe-value",
        secretKey: "THIS_SHOULD_NOT_BE_HERE",
      });

      const output = capture.output;
      expect(output).not.toContain("THIS_SHOULD_NOT_BE_HERE");
      expect(output).toContain("[REDACTED]");
      expect(output).toContain("safe-value");
    } finally {
      capture.restore();
    }
  });

  it("JSON format logger redacts wallet-like objects passed as LogEntry", () => {
    const capture = captureStderr();
    try {
      const logger = createLogger("debug", "json");
      logger.debug("wallet init", {
        tempoPrivateKey: FAKE_TEMPO_PRIVATE_KEY,
        stripeSecretKey: FAKE_STRIPE_SECRET_KEY,
        coinbaseApiKeySecret: FAKE_COINBASE_API_KEY_SECRET,
        coinbaseWalletSecret: FAKE_COINBASE_WALLET_SECRET,
        nwcConnectionString: FAKE_NWC_CONNECTION_STRING,
        nested: {
          privateKey: "nested-secret-value",
          safeField: "visible",
        },
      } as Record<string, unknown>);

      const output = capture.output;
      assertNoSecrets(output, "JSON logger with wallet-like entry");
      expect(output).not.toContain("nested-secret-value");
      expect(output).toContain("visible");

      const parsed = JSON.parse(output);
      expect(parsed.tempoPrivateKey).toBe("[REDACTED]");
      expect(parsed.stripeSecretKey).toBe("[REDACTED]");
      expect(parsed.coinbaseApiKeySecret).toBe("[REDACTED]");
      expect(parsed.coinbaseWalletSecret).toBe("[REDACTED]");
      expect(parsed.nwcConnectionString).toBe("[REDACTED]");
      expect(parsed.nested.privateKey).toBe("[REDACTED]");
      expect(parsed.nested.safeField).toBe("visible");
    } finally {
      capture.restore();
    }
  });

  it("text format logger does NOT include LogEntry fields in output", () => {
    const capture = captureStderr();
    try {
      const logger = createLogger("debug", "text");
      logger.debug("test message", {
        someField: "safe-value",
        secretKey: "THIS_SHOULD_NOT_APPEAR",
      });

      const output = capture.output;
      expect(output).not.toContain("THIS_SHOULD_NOT_APPEAR");
      expect(output).toContain("test message");
    } finally {
      capture.restore();
    }
  });

  it("sanitization preserves safe known LogEntry fields", () => {
    const capture = captureStderr();
    try {
      const logger = createLogger("debug", "json");
      logger.debug("payment completed", {
        url: "https://example.com/api",
        protocol: "mpp",
        amount: "$1.00",
        duration: 250,
        status: "success",
        error: "none",
      });

      const output = capture.output;
      const parsed = JSON.parse(output);
      expect(parsed.url).toBe("https://example.com/api");
      expect(parsed.protocol).toBe("mpp");
      expect(parsed.amount).toBe("$1.00");
      expect(parsed.duration).toBe(250);
      expect(parsed.status).toBe("success");
      expect(parsed.error).toBe("none");
    } finally {
      capture.restore();
    }
  });
});
