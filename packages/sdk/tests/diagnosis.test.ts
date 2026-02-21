import { Money, type ProtocolResult } from "@boltzpay/core";
import { describe, expect, it, vi } from "vitest";

// Store execute mock so we can control return values per test
let executeResult: ProtocolResult;
let probeAllResult: unknown[];

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
      return { address: "0xtest" };
    }
  }
  class MockProtocolRouter {
    constructor() {}
    async probeAll() {
      return probeAllResult;
    }
    async execute() {
      return executeResult;
    }
    async probeFromResponse() {
      return [];
    }
  }
  class MockX402Adapter {
    name = "x402";
    constructor() {}
  }
  class MockL402Adapter {
    name = "l402";
    constructor() {}
  }
  class MockNwcWalletManager {
    constructor() {}
  }
  class MockAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  class MockX402PaymentError extends MockAdapterError {
    deliveryAttempts?: readonly { method: string; headerName: string; status: number }[];
    suggestion?: string;
    constructor(
      message: string,
      opts?: {
        deliveryAttempts?: readonly { method: string; headerName: string; status: number }[];
        suggestion?: string;
      },
    ) {
      super("x402_payment_failed", message);
      this.deliveryAttempts = opts?.deliveryAttempts;
      this.suggestion = opts?.suggestion;
    }
  }
  class MockAggregatePaymentError extends MockAdapterError {
    errors: readonly Error[];
    constructor(errors: readonly Error[]) {
      const messages = errors.map((e, i) => `  ${i + 1}. ${e.message}`).join("\n");
      super("aggregate_payment_failed", `All payment attempts failed:\n${messages}`);
      this.errors = errors;
    }
  }
  return {
    CdpWalletManager: MockCdpWalletManager,
    ProtocolRouter: MockProtocolRouter,
    X402Adapter: MockX402Adapter,
    L402Adapter: MockL402Adapter,
    NwcWalletManager: MockNwcWalletManager,
    AdapterError: MockAdapterError,
    X402PaymentError: MockX402PaymentError,
    AggregatePaymentError: MockAggregatePaymentError,
  };
});

import { BoltzPay } from "../src/boltzpay";
import { ProtocolError } from "../src/errors/protocol-error";

const validConfig = {
  coinbaseApiKeyId: "test-key-id",
  coinbaseApiKeySecret: "test-key-secret",
  coinbaseWalletSecret: "test-wallet-secret",
};

function makeProbeResult(amount = "0.01") {
  return [
    {
      adapter: { name: "x402" },
      quote: {
        amount: Money.fromDollars(amount),
        network: "eip155:8453",
        payTo: "0xpayto",
      },
    },
  ];
}

function makeFailedResult(status: number, body?: string): ProtocolResult {
  return {
    success: false,
    externalTxHash: undefined,
    responseBody: body
      ? new TextEncoder().encode(body)
      : new Uint8Array(),
    responseHeaders: {},
    responseStatus: status,
  };
}

describe("DeliveryDiagnosis", () => {
  describe("HTTP 401 post-payment", () => {
    it("populates diagnosis with auth_required suggestion", async () => {
      probeAllResult = makeProbeResult();
      executeResult = makeFailedResult(
        401,
        JSON.stringify({ error: "API key required" }),
      );

      const sdk = new BoltzPay(validConfig);
      try {
        await sdk.fetch("https://api.example.com/data");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ProtocolError);
        const pe = err as ProtocolError;
        expect(pe.diagnosis).toBeDefined();
        expect(pe.diagnosis!.phase).toBe("delivery");
        expect(pe.diagnosis!.paymentSent).toBe(true);
        expect(pe.diagnosis!.serverStatus).toBe(401);
        expect(pe.diagnosis!.serverMessage).toBe("API key required");
        expect(pe.diagnosis!.suggestion).toContain("authentication");
      }
    });
  });

  describe("HTTP 400 with JSON body", () => {
    it("extracts serverMessage from JSON .message field", async () => {
      probeAllResult = makeProbeResult();
      executeResult = makeFailedResult(
        400,
        JSON.stringify({ message: "Unknown model, available: [gpt-4]" }),
      );

      const sdk = new BoltzPay(validConfig);
      try {
        await sdk.fetch("https://api.example.com/data");
        expect.unreachable("should have thrown");
      } catch (err) {
        const pe = err as ProtocolError;
        expect(pe.diagnosis).toBeDefined();
        expect(pe.diagnosis!.serverStatus).toBe(400);
        expect(pe.diagnosis!.serverMessage).toBe(
          "Unknown model, available: [gpt-4]",
        );
        expect(pe.diagnosis!.suggestion).toContain("rejected");
      }
    });
  });

  describe("HTTP 403 forbidden", () => {
    it("populates diagnosis with forbidden suggestion", async () => {
      probeAllResult = makeProbeResult();
      executeResult = makeFailedResult(403, "Forbidden");

      const sdk = new BoltzPay(validConfig);
      try {
        await sdk.fetch("https://api.example.com/data");
        expect.unreachable("should have thrown");
      } catch (err) {
        const pe = err as ProtocolError;
        expect(pe.diagnosis!.phase).toBe("delivery");
        expect(pe.diagnosis!.serverStatus).toBe(403);
        expect(pe.diagnosis!.suggestion).toContain("Access denied");
      }
    });
  });

  describe("HTTP 404 not found", () => {
    it("suggests checking the URL", async () => {
      probeAllResult = makeProbeResult();
      executeResult = makeFailedResult(404, "Not Found");

      const sdk = new BoltzPay(validConfig);
      try {
        await sdk.fetch("https://api.example.com/data");
        expect.unreachable("should have thrown");
      } catch (err) {
        const pe = err as ProtocolError;
        expect(pe.diagnosis!.serverStatus).toBe(404);
        expect(pe.diagnosis!.suggestion).toContain("URL");
      }
    });
  });

  describe("HTTP 500 server error", () => {
    it("populates diagnosis with server_error suggestion", async () => {
      probeAllResult = makeProbeResult();
      executeResult = makeFailedResult(
        500,
        JSON.stringify({ error: "Internal server error" }),
      );

      const sdk = new BoltzPay(validConfig);
      try {
        await sdk.fetch("https://api.example.com/data");
        expect.unreachable("should have thrown");
      } catch (err) {
        const pe = err as ProtocolError;
        expect(pe.diagnosis!.serverStatus).toBe(500);
        expect(pe.diagnosis!.serverMessage).toBe("Internal server error");
        expect(pe.diagnosis!.suggestion).toContain("Server error");
      }
    });
  });

  describe("empty body", () => {
    it("diagnosis has undefined serverMessage when body is empty", async () => {
      probeAllResult = makeProbeResult();
      executeResult = makeFailedResult(401);

      const sdk = new BoltzPay(validConfig);
      try {
        await sdk.fetch("https://api.example.com/data");
        expect.unreachable("should have thrown");
      } catch (err) {
        const pe = err as ProtocolError;
        expect(pe.diagnosis!.serverMessage).toBeUndefined();
        expect(pe.diagnosis!.serverStatus).toBe(401);
      }
    });
  });

  describe("nested JSON error", () => {
    it("extracts message from nested .error.message", async () => {
      probeAllResult = makeProbeResult();
      executeResult = makeFailedResult(
        400,
        JSON.stringify({ error: { message: "Rate limit exceeded" } }),
      );

      const sdk = new BoltzPay(validConfig);
      try {
        await sdk.fetch("https://api.example.com/data");
        expect.unreachable("should have thrown");
      } catch (err) {
        const pe = err as ProtocolError;
        expect(pe.diagnosis!.serverMessage).toBe("Rate limit exceeded");
      }
    });
  });

  describe("plain text body", () => {
    it("uses raw text as serverMessage", async () => {
      probeAllResult = makeProbeResult();
      executeResult = makeFailedResult(401, "Unauthorized: missing API key");

      const sdk = new BoltzPay(validConfig);
      try {
        await sdk.fetch("https://api.example.com/data");
        expect.unreachable("should have thrown");
      } catch (err) {
        const pe = err as ProtocolError;
        expect(pe.diagnosis!.serverMessage).toBe(
          "Unauthorized: missing API key",
        );
      }
    });
  });

  describe("successful payment has no diagnosis", () => {
    it("does not attach diagnosis on success", async () => {
      probeAllResult = makeProbeResult();
      executeResult = {
        success: true,
        externalTxHash: "0xtx",
        responseBody: new TextEncoder().encode('{"ok":true}'),
        responseHeaders: { "content-type": "application/json" },
        responseStatus: 200,
      };

      const sdk = new BoltzPay(validConfig);
      const response = await sdk.fetch("https://api.example.com/data");
      expect(response.ok).toBe(true);
    });
  });
});
