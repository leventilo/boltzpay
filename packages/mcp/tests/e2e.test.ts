import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const DIST_PATH = resolve(import.meta.dirname, "../dist/index.js");

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function sendRequest(
  proc: ChildProcess,
  request: JsonRpcRequest,
  timeout = 5000,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    if (!proc.stdout || !proc.stdin) {
      reject(new Error("Process stdin/stdout not available"));
      return;
    }

    const stdout = proc.stdout;
    const stdin = proc.stdin;

    const timer = setTimeout(
      () =>
        reject(new Error(`Timeout waiting for response to ${request.method}`)),
      timeout,
    );

    const onData = (chunk: Buffer) => {
      const lines = chunk.toString("utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (parsed.id === request.id) {
            clearTimeout(timer);
            stdout.off("data", onData);
            resolve(parsed);
            return;
          }
        } catch (_parseError: unknown) {
          // Partial JSON data from stdout, wait for next chunk
        }
      }
    };

    stdout.on("data", onData);
    stdin.write(`${JSON.stringify(request)}\n`);
  });
}

describe("MCP Server E2E - stdio", () => {
  let proc: ChildProcess | undefined;

  afterEach(() => {
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
    }
    proc = undefined;
  });

  it(
    "should accept initialize and list 7 tools via JSON-RPC",
    { timeout: 15000 },
    async () => {
      proc = spawn("node", [DIST_PATH], {
        env: {
          ...process.env,
          COINBASE_API_KEY_ID: "test-key-id",
          COINBASE_API_KEY_SECRET: "test-key-secret",
          COINBASE_WALLET_SECRET: "test-wallet-secret",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const stderrChunks: string[] = [];
      if (proc.stderr) {
        proc.stderr.on("data", (chunk: Buffer) => {
          stderrChunks.push(chunk.toString("utf-8"));
        });
      }

      await new Promise((r) => setTimeout(r, 500));

      expect(proc.exitCode).toBeNull();

      const initResponse = await sendRequest(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-e2e", version: "1.0.0" },
        },
      });

      expect(initResponse.error).toBeUndefined();
      expect(initResponse.result).toBeDefined();
      const initResult = initResponse.result as {
        serverInfo: { name: string };
      };
      expect(initResult.serverInfo.name).toBe("boltzpay");

      if (!proc.stdin) {
        throw new Error("Process stdin not available");
      }
      proc.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        })}\n`,
      );

      await new Promise((r) => setTimeout(r, 100));

      const listResponse = await sendRequest(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });

      expect(listResponse.error).toBeUndefined();
      expect(listResponse.result).toBeDefined();
      const listResult = listResponse.result as {
        tools: Array<{ name: string; description: string }>;
      };
      expect(listResult.tools).toHaveLength(7);

      const toolNames = listResult.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        "boltzpay_budget",
        "boltzpay_check",
        "boltzpay_discover",
        "boltzpay_fetch",
        "boltzpay_history",
        "boltzpay_quote",
        "boltzpay_wallet",
      ]);

      const callResponse = await sendRequest(proc, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "boltzpay_discover",
          arguments: { category: "demo" },
        },
      });

      expect(callResponse.error).toBeUndefined();
      expect(callResponse.result).toBeDefined();
      const callResult = callResponse.result as {
        content: Array<{ type: string; text: string }>;
      };
      expect(callResult.content).toHaveLength(1);
      const apis = JSON.parse(callResult.content[0].text);
      expect(apis.length).toBeGreaterThanOrEqual(1);
      expect(apis[0].category).toBe("demo");
    },
  );
});
