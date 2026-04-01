import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionOptions } from "@boltzpay/core";
import { MppSessionManager, isStreamableSession } from "../../src/mpp/mpp-session-adapter";
import type { ChannelUpdateEntry, MppStreamEvent } from "../../src/mpp/mpp-session-adapter";

const MOCK_CHANNEL_ID = "0x" + "ab".repeat(32);

function createMockMppx(overrides?: {
  fetchResponse?: Response;
  createCredentialResult?: string;
}) {
  const mockFetch = vi.fn().mockResolvedValue(
    overrides?.fetchResponse ??
      new Response("ok", {
        status: 200,
        headers: { "Payment-Receipt": "mock-receipt" },
      }),
  );
  const mockCreateCredential = vi
    .fn()
    .mockResolvedValue(overrides?.createCredentialResult ?? "Payment cred123");

  return {
    fetch: mockFetch,
    createCredential: mockCreateCredential,
    rawFetch: globalThis.fetch,
    methods: [],
    transport: {},
  };
}

// Test backdoor: mppx/client captures the onChannelUpdate callback and mppx instance
// inside the mock factory closure. The __test__ bridge is necessary to simulate mppx
// channel-update events and inspect the internal mppx mock from tests, since the real
// library fires these via internal WebSocket subscriptions we cannot replicate.
interface MppxTestBridge {
  triggerChannelUpdate(entry: ChannelUpdateEntry): void;
  getMppx(): ReturnType<typeof createMockMppx> | undefined;
}

interface MockMppxClient {
  session: ReturnType<typeof vi.fn>;
  Mppx: { create: ReturnType<typeof vi.fn> };
  __test__: MppxTestBridge;
}

vi.mock("mppx/client", () => {
  let onChannelUpdateFn: ((entry: ChannelUpdateEntry) => void) | undefined;
  let capturedMppx: ReturnType<typeof createMockMppx> | undefined;

  return {
    session: vi.fn().mockImplementation((params: { onChannelUpdate?: (entry: ChannelUpdateEntry) => void }) => {
      onChannelUpdateFn = params?.onChannelUpdate;
      return { name: "tempo", intent: "session" };
    }),
    Mppx: {
      create: vi.fn().mockImplementation(() => {
        capturedMppx = createMockMppx();
        return capturedMppx;
      }),
    },
    __test__: {
      triggerChannelUpdate(entry: ChannelUpdateEntry) {
        onChannelUpdateFn?.(entry);
      },
      getMppx() {
        return capturedMppx;
      },
    },
  } satisfies MockMppxClient;
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({
    address: "0x1234567890abcdef1234567890abcdef12345678",
  }),
}));

async function getTestBridge(): Promise<MppxTestBridge> {
  // vi.mock returns the mock module as unknown; cast to typed interface for test bridge access
  const mod: MockMppxClient = await import("mppx/client") as unknown as MockMppxClient;
  return mod.__test__;
}

describe("MppSessionManager", () => {
  const TEST_PRIVATE_KEY = "0x" + "aa".repeat(32);
  const TEST_URL = "https://api.example.com/chat";
  let onUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onUpdate = vi.fn();
  });

  it("implements SessionAdapter interface with name 'mpp-session'", () => {
    const adapter = new MppSessionManager(
      { tempoPrivateKey: TEST_PRIVATE_KEY },
      onUpdate,
    );
    expect(adapter.name).toBe("mpp-session");
  });

  describe("openSession", () => {
    it("creates Mppx.create with session method and returns a ManagedSession", async () => {
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      const options: SessionOptions = { maxDeposit: 10000000n };
      const session = await adapter.openSession(TEST_URL, options);

      expect(session).toBeDefined();
      expect(typeof session.fetch).toBe("function");
      expect(typeof session.close).toBe("function");
    });

    it("passes maxDeposit to session method configuration (integer division)", async () => {
      const { session: sessionFn } = await import("mppx/client");
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );

      const MAX_DEPOSIT_ATOMIC = 5_000_000n;
      const DECIMALS_DIVISOR = 10n ** 6n;
      const expectedHuman = (MAX_DEPOSIT_ATOMIC / DECIMALS_DIVISOR).toString();

      await adapter.openSession(TEST_URL, { maxDeposit: MAX_DEPOSIT_ATOMIC });

      expect(sessionFn).toHaveBeenCalledWith(
        expect.objectContaining({
          maxDeposit: expectedHuman,
        }),
      );
    });

    it("passes maxDeposit with fractional part preserving precision", async () => {
      const { session: sessionFn } = await import("mppx/client");
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );

      const MAX_DEPOSIT_ATOMIC = 5_500_000n;

      await adapter.openSession(TEST_URL, { maxDeposit: MAX_DEPOSIT_ATOMIC });

      expect(sessionFn).toHaveBeenCalledWith(
        expect.objectContaining({
          maxDeposit: "5.5",
        }),
      );
    });

    it("creates viem account from tempoPrivateKey", async () => {
      const { privateKeyToAccount } = await import("viem/accounts");
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      await adapter.openSession(TEST_URL, {});

      expect(privateKeyToAccount).toHaveBeenCalledWith(TEST_PRIVATE_KEY);
    });

    it("performs initial fetch to trigger 402 challenge", async () => {
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      const session = await adapter.openSession(TEST_URL, {});

      const bridge = await getTestBridge();
      const mppx = bridge.getMppx();
      expect(mppx?.fetch).toHaveBeenCalledWith(TEST_URL, expect.any(Object));
    });
  });

  describe("MppManagedSession.fetch", () => {
    it("delegates to mppx.fetch and returns the response", async () => {
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      const session = await adapter.openSession(TEST_URL, {});
      const result = await session.fetch(TEST_URL);

      expect(result).toBeDefined();
    });
  });

  describe("MppManagedSession.close", () => {
    it("returns SessionCloseResult with channelId and amounts", async () => {
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      const session = await adapter.openSession(TEST_URL, {});

      const bridge = await getTestBridge();
      bridge.triggerChannelUpdate({
        channelId: MOCK_CHANNEL_ID,
        salt: "0x" + "00".repeat(32),
        cumulativeAmount: 500000n,
        escrowContract: "0x" + "cc".repeat(20),
        chainId: 4217,
        opened: true,
      });

      const result = await session.close();

      expect(result).toEqual(
        expect.objectContaining({
          channelId: MOCK_CHANNEL_ID,
          totalSpent: expect.any(BigInt),
        }),
      );
    });
  });

  describe("onChannelUpdate callback", () => {
    it("forwards channel updates to the provided callback", async () => {
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      await adapter.openSession(TEST_URL, {});

      const bridge = await getTestBridge();
      const entry: ChannelUpdateEntry = {
        channelId: MOCK_CHANNEL_ID,
        salt: "0x" + "00".repeat(32),
        cumulativeAmount: 100000n,
        escrowContract: "0x" + "cc".repeat(20),
        chainId: 4217,
        opened: true,
      };
      bridge.triggerChannelUpdate(entry);

      expect(onUpdate).toHaveBeenCalledWith(entry);
    });
  });

  describe("error handling", () => {
    it("wraps mppx errors in MppPaymentError", async () => {
      const { Mppx } = await import("mppx/client");
      (Mppx.create as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        fetch: vi.fn().mockRejectedValue(new Error("mppx session failed")),
        createCredential: vi.fn(),
        rawFetch: globalThis.fetch,
        methods: [],
        transport: {},
      }));

      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );

      await expect(adapter.openSession(TEST_URL, {})).rejects.toThrow(
        "MPP session open failed",
      );
    });
  });

  describe("isStreamableSession", () => {
    it("returns true for MppManagedSession instances", async () => {
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      const session = await adapter.openSession(TEST_URL, {});

      expect(isStreamableSession(session)).toBe(true);
    });

    it("returns false for plain ManagedSession without stream", () => {
      const plainSession = {
        channelId: "0x" + "ab".repeat(32),
        spent: 0n,
        fetch: vi.fn(),
        close: vi.fn(),
      };

      expect(isStreamableSession(plainSession)).toBe(false);
    });
  });

  describe("MppManagedSession.stream", () => {
    it("yields a single data event for non-SSE responses", async () => {
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      const session = await adapter.openSession(TEST_URL, {});

      const bridge = await getTestBridge();
      const mppx = bridge.getMppx();

      mppx?.fetch.mockResolvedValueOnce(
        new Response("plain text response", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      if (!isStreamableSession(session)) throw new Error("Expected streamable");

      const events: MppStreamEvent[] = [];
      for await (const event of session.stream(TEST_URL)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "data", payload: "plain text response" });
    });

    it("yields data events from SSE stream", async () => {
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      const session = await adapter.openSession(TEST_URL, {});

      const bridge = await getTestBridge();
      const mppx = bridge.getMppx();

      const sseBody = "data: hello\n\ndata: world\n\n";
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      });

      mppx?.fetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );

      if (!isStreamableSession(session)) throw new Error("Expected streamable");

      const events: MppStreamEvent[] = [];
      for await (const event of session.stream(TEST_URL)) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "data", payload: "hello" });
      expect(events[1]).toEqual({ type: "data", payload: "world" });
    });

    it("yields payment events when channel updates occur during stream", async () => {
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      const session = await adapter.openSession(TEST_URL, {});

      const bridge = await getTestBridge();
      const mppx = bridge.getMppx();

      const channelEntry: ChannelUpdateEntry = {
        channelId: MOCK_CHANNEL_ID,
        salt: "0x" + "00".repeat(32),
        cumulativeAmount: 100000n,
        escrowContract: "0x" + "cc".repeat(20),
        chainId: 4217,
        opened: true,
      };

      let chunkIndex = 0;
      const chunks = [
        "data: chunk1\n\n",
        "data: chunk2\n\n",
      ];

      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunkIndex >= chunks.length) {
            controller.close();
            return;
          }
          const chunk = chunks[chunkIndex];
          if (chunk === undefined) {
            controller.close();
            return;
          }
          controller.enqueue(new TextEncoder().encode(chunk));
          // Trigger channel update after second chunk
          if (chunkIndex === 1) {
            bridge.triggerChannelUpdate(channelEntry);
          }
          chunkIndex++;
        },
      });

      mppx?.fetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );

      if (!isStreamableSession(session)) throw new Error("Expected streamable");

      const events: MppStreamEvent[] = [];
      for await (const event of session.stream(TEST_URL)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThanOrEqual(2);
      const dataEvents = events.filter((e) => e.type === "data");
      const paymentEvents = events.filter((e) => e.type === "payment");

      expect(dataEvents).toHaveLength(2);
      expect(paymentEvents).toHaveLength(1);
      expect(paymentEvents[0]).toEqual(expect.objectContaining({
        type: "payment",
        channelId: MOCK_CHANNEL_ID,
        cumulativeAmount: 100000n,
        index: 1,
      }));
    });

    it("returns empty for SSE response with no body", async () => {
      const adapter = new MppSessionManager(
        { tempoPrivateKey: TEST_PRIVATE_KEY },
        onUpdate,
      );
      const session = await adapter.openSession(TEST_URL, {});

      const bridge = await getTestBridge();
      const mppx = bridge.getMppx();

      const mockResponse = {
        headers: {
          get: vi.fn().mockReturnValue("text/event-stream"),
        },
        body: null,
        text: vi.fn().mockResolvedValue(""),
      };
      mppx?.fetch.mockResolvedValueOnce(mockResponse);

      if (!isStreamableSession(session)) throw new Error("Expected streamable");

      const events: MppStreamEvent[] = [];
      for await (const event of session.stream(TEST_URL)) {
        events.push(event);
      }

      expect(events).toHaveLength(0);
    });
  });
});
