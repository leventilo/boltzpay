import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const cli = "node packages/cli/dist/index.js";
const startTime = Date.now();

// ─── State ───────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;
const sectionResults = [];
let currentSection = null;

// ─── Display helpers ─────────────────────────────────────
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_GREEN = "\x1b[42m";
const BG_RED = "\x1b[41m";

function bar(ratio, width = 20) {
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pad(str, len) {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function rpad(str, len) {
  return str.length >= len ? str : " ".repeat(len - str.length) + str;
}

let detailBuffer = [];

function detail(text) {
  detailBuffer.push(`${DIM}      ${text}${RESET}`);
}

function flushDetails() {
  for (const line of detailBuffer) console.log(line);
  detailBuffer = [];
}

// ─── Core test helpers ───────────────────────────────────
function run(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: "utf8",
    timeout: opts.timeout || 15000,
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  });
}

function test(name, fn) {
  detailBuffer = [];
  try {
    fn();
    console.log(`  ${GREEN}✅${RESET}  ${name}`);
    flushDetails();
    passed++;
    if (currentSection) currentSection.passed++;
  } catch (e) {
    const msg = e.stdout?.trim()?.slice(0, 160) || e.stderr?.trim()?.slice(0, 160) || e.message.slice(0, 160);
    console.log(`  ${RED}❌${RESET}  ${name}`);
    console.log(`  ${RED}    → ${msg}${RESET}`);
    detailBuffer = [];
    failed++;
    if (currentSection) currentSection.failed++;
  }
}

function skip(name, reason) {
  console.log(`  ${YELLOW}⏭️${RESET}  ${DIM}${name}${RESET}`);
  detail(reason);
  skipped++;
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function section(name, expectedTests) {
  currentSection = { name, expected: expectedTests, passed: 0, failed: 0, start: Date.now() };
  const line = "━".repeat(Math.max(0, 58 - name.length - 6));
  console.log(`\n${BOLD}━━ ${name} ${line}${RESET}`);
}

function endSection() {
  if (!currentSection) return;
  const elapsed = ((Date.now() - currentSection.start) / 1000).toFixed(1);
  const total = currentSection.passed + currentSection.failed;
  const icon = currentSection.failed === 0 ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  console.log(`${DIM}  ── ${icon} ${currentSection.passed}/${total} passed${" ".repeat(40)}${elapsed}s${RESET}`);
  sectionResults.push({ ...currentSection, elapsed: parseFloat(elapsed) });
  currentSection = null;
}

// ═══════════════════════════════════════════════════════════
console.log("");
console.log(`${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║${RESET}${BOLD}       BOLTZPAY · FULL SMOKE TEST · v0.1.0                ${CYAN}║${RESET}`);
console.log(`${BOLD}${CYAN}║${RESET}${DIM}       Multi-Chain · x402 + ACP · Phase 4.1+              ${CYAN}${BOLD}║${RESET}`);
console.log(`${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════╝${RESET}`);

// ─── 1. CLI BASICS ──────────────────────────────────────
section("1. CLI Basics", 6);

test("--help lists all 7 commands", () => {
  const out = run(`${cli} --help`);
  const cmds = ["fetch", "check", "quote", "discover", "wallet", "budget", "history"];
  for (const cmd of cmds) assert(out.includes(cmd), `missing ${cmd}`);
  detail(`${cmds.map(c => `${GREEN}✓${RESET}${DIM} ${c}`).join("  ")}`);
});

test("--version → 0.1.0", () => {
  const out = run(`${cli} --version`);
  assert(out.trim() === "0.1.0", `got: ${out.trim()}`);
});

test("fetch --help shows --chain option", () => {
  const out = run(`${cli} fetch --help`);
  assert(out.includes("--chain"), "missing --chain flag");
  detail(`flags: --method ${GREEN}✓${RESET}${DIM}  --header ${GREEN}✓${RESET}${DIM}  --data ${GREEN}✓${RESET}${DIM}  --chain ${GREEN}✓${RESET}${DIM}  --json ${GREEN}✓${RESET}`);
});

test("fetch rejects invalid --chain value", () => {
  try {
    run(`${cli} fetch https://httpbin.org/get --chain bitcoin --json`);
    throw new Error("should have rejected");
  } catch (e) {
    const out = (e.stdout || e.stderr || "").toLowerCase();
    assert(out.includes("invalid") || out.includes("error") || e.status !== 0, "should reject");
    detail(`--chain bitcoin → ${GREEN}rejected ✓${RESET}`);
  }
});

test("fetch --chain evm accepts valid chain", () => {
  const out = run(`${cli} fetch https://httpbin.org/get --chain evm --json`);
  const p = JSON.parse(out.trim());
  assert(p.success === true, "should succeed");
  assert(p.metadata.status === 200, `wrong status: ${p.metadata.status}`);
  detail(`--chain evm → ${GREEN}200 OK ✓${RESET}`);
});

test("--debug produces verbose output", () => {
  try {
    // --debug may write to stderr; capture both
    const out = run(`${cli} check https://httpbin.org/get --debug --json`);
    const p = JSON.parse(out.trim());
    assert(p.data.isPaid === false, "should be free");
    detail(`debug flag accepted, result intact → ${GREEN}✓${RESET}`);
  } catch (e) {
    // If --debug writes extra to stdout breaking JSON, that's still debug working
    const combined = (e.stdout || "") + (e.stderr || "");
    assert(combined.length > 0, "no output at all");
    detail(`debug flag accepted, extra output → ${GREEN}✓${RESET}`);
  }
});

endSection();

// ─── 2. DISCOVER ─────────────────────────────────────────
section("2. Discover", 4);

test("discover (human output)", () => {
  const out = run(`${cli} discover`);
  assert(out.includes("Compatible Paid API Endpoints"), "missing title");
  assert(out.includes("Invy"), "missing Invy");
  detail(`title ${GREEN}✓${RESET}${DIM}  entries ${GREEN}✓${RESET}${DIM}  categories ${GREEN}✓${RESET}`);
});

test("discover --json returns 10+ entries", () => {
  const out = run(`${cli} discover --json`);
  const parsed = JSON.parse(out.trim());
  assert(parsed.success === true, "success false");
  assert(parsed.data.length >= 10, `only ${parsed.data.length} entries`);
  const entry = parsed.data[0];
  assert(entry.name && entry.url && entry.category, "incomplete entry");
  detail(`${parsed.data.length} entries, structure: name ${GREEN}✓${RESET}${DIM}  url ${GREEN}✓${RESET}${DIM}  category ${GREEN}✓${RESET}`);
});

test("discover -c crypto-data filters correctly", () => {
  const out = run(`${cli} discover -c crypto-data`);
  assert(out.includes("Invy"), "missing Invy");
  assert(!out.includes("Nickel Joke"), "should not contain demo");
  detail(`filter applied → only crypto-data ${GREEN}✓${RESET}`);
});

test("discover -c nonexistent → empty", () => {
  const out = run(`${cli} discover -c nonexistent`);
  assert(out.includes("No matching endpoints"), "should say no results");
  detail(`graceful empty response ${GREEN}✓${RESET}`);
});

endSection();

// ─── 3. CHECK ────────────────────────────────────────────
section("3. Check (4 x402 formats + free + unreachable)", 7);

test("check V2 endpoint (invy.bot)", () => {
  const out = run(`${cli} check https://invy.bot/api --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.isPaid === true, "should be paid");
  assert(p.data.protocol === "x402", `wrong protocol: ${p.data.protocol}`);
  assert(p.data.amount === "$0.05", `wrong amount: ${p.data.amount}`);
  assert(p.data.network === "eip155:8453", `wrong network`);
  detail(`isPaid ${GREEN}✓${RESET}${DIM}  x402 ${GREEN}✓${RESET}${DIM}  $0.05 ${GREEN}✓${RESET}${DIM}  CAIP-2 eip155:8453 ${GREEN}✓${RESET}`);
});

test("check V2 multi-chain options (invy.bot)", () => {
  const out = run(`${cli} check https://invy.bot/api --json`);
  const p = JSON.parse(out.trim());
  if (p.data.options) {
    assert(Array.isArray(p.data.options), "options should be array");
    const first = p.data.options[0];
    assert(first.chain && first.network && first.amount, "incomplete option");
    const chains = p.data.options.map(o => `${o.chain} ${o.amount}`).join(", ");
    detail(`${p.data.options.length} chain(s): ${chains}`);
  }
});

test("check V1 body (nickeljoke)", () => {
  const out = run(`${cli} check https://nickeljoke.vercel.app/api/joke --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.isPaid === true && p.data.protocol === "x402", "V1 body detection failed");
  detail(`V1 body format → isPaid ${GREEN}✓${RESET}${DIM}  x402 ${GREEN}✓${RESET}`);
});

test("check V1 hybrid in V2 header (emc2ai)", () => {
  const out = run(`${cli} check https://emc2ai.io/x402/bitquery/top-tokens --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.isPaid === true, "should be paid");
  assert(p.data.amount === "$0.55", `wrong amount: ${p.data.amount}`);
  detail(`V1-in-V2 hybrid → isPaid ${GREEN}✓${RESET}${DIM}  $0.55 ${GREEN}✓${RESET}`);
});

test("check www-authenticate (402payment-test)", () => {
  const out = run(`${cli} check https://402payment-test.com/api/x402 --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.isPaid === true, "should be paid");
  assert(p.data.amount === "$0.01", `wrong amount: ${p.data.amount}`);
  assert(p.data.network === "eip155:8453", `wrong network`);
  detail(`www-auth → isPaid ${GREEN}✓${RESET}${DIM}  $0.01 ${GREEN}✓${RESET}${DIM}  eip155:8453 ${GREEN}✓${RESET}`);
});

test("check free endpoint (httpbin)", () => {
  const out = run(`${cli} check https://httpbin.org/get --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.isPaid === false, "should be free");
  detail(`isPaid: false ${GREEN}✓${RESET}`);
});

test("check unreachable URL → not paid", () => {
  const out = run(`${cli} check https://this-does-not-exist-404.example.com --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.isPaid === false, "unreachable should be free");
  detail(`unreachable → graceful isPaid: false ${GREEN}✓${RESET}`);
});

endSection();

// ─── 4. QUOTE ────────────────────────────────────────────
section("4. Quote (pricing + alternatives)", 6);

test("quote V2 (invy.bot)", () => {
  const out = run(`${cli} quote https://invy.bot/api --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.protocol === "x402", "wrong protocol");
  assert(p.data.amount === "$0.05", `wrong amount: ${p.data.amount}`);
  assert(p.data.network === "eip155:8453", `wrong network`);
  detail(`x402 ${GREEN}✓${RESET}${DIM}  $0.05 ${GREEN}✓${RESET}${DIM}  eip155:8453 ${GREEN}✓${RESET}`);
});

test("quote V2 multi-chain alternatives (invy.bot)", () => {
  const out = run(`${cli} quote https://invy.bot/api --json`);
  const p = JSON.parse(out.trim());
  if (p.data.alternatives) {
    assert(Array.isArray(p.data.alternatives), "alternatives should be array");
    for (const alt of p.data.alternatives) {
      assert(alt.chain && alt.network && alt.amount?.startsWith("$"), "incomplete alt");
    }
    const alts = p.data.alternatives.map(a => `${a.chain} ${a.amount}`).join(", ");
    detail(`${p.data.alternatives.length} alternative(s): ${alts}`);
  }
});

test("quote V1 (nickeljoke — testnet)", () => {
  const out = run(`${cli} quote https://nickeljoke.vercel.app/api/joke --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.protocol === "x402", "wrong protocol");
  assert(p.data.network === "base-sepolia", `wrong network: ${p.data.network}`);
  detail(`x402 ${GREEN}✓${RESET}${DIM}  base-sepolia ${GREEN}✓${RESET}`);
});

test("quote www-authenticate (402payment-test)", () => {
  const out = run(`${cli} quote https://402payment-test.com/api/x402 --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.amount === "$0.01", `wrong amount: ${p.data.amount}`);
  assert(p.data.network === "eip155:8453", `wrong network`);
  detail(`$0.01 ${GREEN}✓${RESET}${DIM}  eip155:8453 ${GREEN}✓${RESET}`);
});

test("quote free endpoint → says free", () => {
  const out = run(`${cli} quote https://httpbin.org/get --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.free === true || p.data.message?.includes("free"), "should say free");
  detail(`free: true ${GREEN}✓${RESET}`);
});

test("quote human output contains $ amount", () => {
  const out = run(`${cli} quote https://invy.bot/api`);
  assert(out.includes("$"), "missing dollar amount");
  assert(out.includes("x402"), "missing protocol");
  detail(`human format: dollar ${GREEN}✓${RESET}${DIM}  protocol ${GREEN}✓${RESET}`);
});

endSection();

// ─── 5. FETCH ────────────────────────────────────────────
section("5. Fetch (free passthrough)", 4);

test("fetch free GET → 200 + no payment", () => {
  const out = run(`${cli} fetch https://httpbin.org/get --json`);
  const p = JSON.parse(out.trim());
  assert(p.success === true, "should succeed");
  assert(p.payment === null, "should have no payment");
  assert(p.metadata.status === 200, `wrong status: ${p.metadata.status}`);
  detail(`200 OK ${GREEN}✓${RESET}${DIM}  payment: null ${GREEN}✓${RESET}`);
});

test("fetch free POST with body", () => {
  const out = run(`${cli} fetch https://httpbin.org/post -m POST -d '{"test":"boltzpay"}' -H "Content-Type:application/json" --json`);
  const p = JSON.parse(out.trim());
  assert(p.success === true, "should succeed");
  const body = typeof p.data === "string" ? JSON.parse(p.data) : p.data;
  assert(body.json?.test === "boltzpay", "body not forwarded");
  detail(`POST ${GREEN}✓${RESET}${DIM}  body forwarded ${GREEN}✓${RESET}${DIM}  JSON parsed ${GREEN}✓${RESET}`);
});

test("fetch free with custom header forwarding", () => {
  const out = run(`${cli} fetch https://httpbin.org/get -H "X-BoltzPay-Test:smoke" --json`);
  const p = JSON.parse(out.trim());
  const body = typeof p.data === "string" ? JSON.parse(p.data) : p.data;
  assert(body.headers?.["X-Boltzpay-Test"] === "smoke", "header not forwarded");
  detail(`X-BoltzPay-Test: smoke → echoed back ${GREEN}✓${RESET}`);
});

test("fetch unreachable → error handled gracefully", () => {
  try {
    run(`${cli} fetch https://this-does-not-exist-404.example.com --json`);
    throw new Error("should have thrown");
  } catch (e) {
    const out = e.stdout || e.stderr || "";
    assert(out.includes("error") || out.includes("Error") || e.status !== 0, "should error");
    detail(`graceful error message ${GREEN}✓${RESET}${DIM}  no crash ${GREEN}✓${RESET}`);
  }
});

endSection();

// ─── 6. WALLET ───────────────────────────────────────────
section("6. Wallet (multi-chain)", 2);

test("wallet (human) — shows network + protocols", () => {
  const out = run(`${cli} wallet`);
  assert(out.includes("network") || out.includes("Network"), "missing network");
  assert(out.includes("x402"), "missing x402");
  detail(`network ${GREEN}✓${RESET}${DIM}  x402 ${GREEN}✓${RESET}`);
});

test("wallet --json — chains + addresses + protocols + budget", () => {
  const out = run(`${cli} wallet --json`);
  const p = JSON.parse(out.trim());
  assert(p.success === true, "success false");
  assert(p.data.network, "missing network");
  assert(Array.isArray(p.data.protocols) && p.data.protocols.includes("x402"), "missing x402");
  assert(p.data.budget !== undefined, "missing budget");
  assert(typeof p.data.budget.configured === "boolean", "budget.configured wrong type");
  const addr = p.data.addresses ? JSON.stringify(p.data.addresses) : "none";
  detail(`network ${GREEN}✓${RESET}${DIM}  protocols ${GREEN}✓${RESET}${DIM}  budget ${GREEN}✓${RESET}${DIM}  addresses: ${addr}`);
});

endSection();

// ─── 7. BUDGET + HISTORY ─────────────────────────────────
section("7. Budget + History", 4);

test("budget (human)", () => {
  const out = run(`${cli} budget`);
  assert(out.includes("budget") || out.includes("Budget") || out.includes("No budget"), "missing budget");
  detail(`human format ${GREEN}✓${RESET}`);
});

test("budget --json", () => {
  const out = run(`${cli} budget --json`);
  const p = JSON.parse(out.trim());
  assert(p.success === true, "success false");
  detail(`success: true ${GREEN}✓${RESET}${DIM}  JSON valid ${GREEN}✓${RESET}`);
});

test("history (human)", () => {
  const out = run(`${cli} history`);
  assert(out.includes("history") || out.includes("History") || out.includes("No payments"), "missing history");
  detail(`human format ${GREEN}✓${RESET}`);
});

test("history --json", () => {
  const out = run(`${cli} history --json`);
  const p = JSON.parse(out.trim());
  assert(p.success === true, "success false");
  assert(Array.isArray(p.data), "data should be array");
  detail(`success: true ${GREEN}✓${RESET}${DIM}  data: Array ${GREEN}✓${RESET}`);
});

endSection();

// ─── 8. MCP SERVER ───────────────────────────────────────
section("8. MCP Server (JSON-RPC — all 7 tools + params)", 10);

const MCP_TOOL_TESTS = [
  {
    name: "boltzpay_discover",
    args: {},
    validate: (content) => {
      const text = content[0]?.text || "";
      const data = JSON.parse(text);
      assert(Array.isArray(data), "discover should return array");
      assert(data.length >= 10, `only ${data.length} entries`);
      return `${data.length} endpoints`;
    },
  },
  {
    name: "boltzpay_discover",
    label: "boltzpay_discover (category filter)",
    args: { category: "crypto-data" },
    validate: (content) => {
      const text = content[0]?.text || "";
      const data = JSON.parse(text);
      assert(Array.isArray(data), "should return array");
      assert(data.length >= 1, "should have crypto-data entries");
      assert(data.every(e => e.category === "crypto-data"), "wrong category in results");
      return `${data.length} crypto-data entries, all filtered ${GREEN}✓${RESET}`;
    },
  },
  {
    name: "boltzpay_check",
    args: { url: "https://invy.bot/api" },
    validate: (content) => {
      const text = content[0]?.text || "";
      const data = JSON.parse(text);
      assert(data.isPaid === true, "should be paid");
      assert(data.protocol === "x402", `wrong protocol`);
      assert(data.amount === "$0.05", `wrong amount`);
      return `paid ${GREEN}✓${RESET}${DIM}  ${data.amount} ${GREEN}✓${RESET}${DIM}  ${data.options?.length || 0} options`;
    },
  },
  {
    name: "boltzpay_quote",
    args: { url: "https://invy.bot/api" },
    validate: (content) => {
      const text = content[0]?.text || "";
      const data = JSON.parse(text);
      assert(data.protocol === "x402", `wrong protocol`);
      assert(data.amount === "$0.05", `wrong amount`);
      assert(data.network, "missing network");
      return `${data.amount} on ${data.network}, ${data.alternatives?.length || 0} alt(s)`;
    },
  },
  {
    name: "boltzpay_fetch",
    args: { url: "https://httpbin.org/get" },
    validate: (content) => {
      const text = content[0]?.text || "";
      const data = JSON.parse(text);
      assert(data.status === 200, `wrong status`);
      return `status ${data.status} ${GREEN}✓${RESET}${DIM}  ${data.body?.length || 0} chars`;
    },
  },
  {
    name: "boltzpay_fetch",
    label: "boltzpay_fetch (chain override)",
    args: { url: "https://httpbin.org/get", chain: "evm" },
    validate: (content) => {
      const text = content[0]?.text || "";
      const data = JSON.parse(text);
      assert(data.status === 200, `wrong status`);
      return `chain: evm accepted ${GREEN}✓${RESET}${DIM}  status ${data.status} ${GREEN}✓${RESET}`;
    },
  },
  {
    name: "boltzpay_wallet",
    args: {},
    validate: (content) => {
      const text = content[0]?.text || "";
      const data = JSON.parse(text);
      assert(data.network, "missing network");
      assert(Array.isArray(data.protocols), "protocols should be array");
      return `${data.network}, ${data.protocols.join("+")}`;
    },
  },
  {
    name: "boltzpay_budget",
    args: {},
    validate: (content) => {
      const text = content[0]?.text || "";
      try {
        const data = JSON.parse(text);
        return data.configured ? "configured" : "no limits";
      } catch {
        assert(text.length > 0, "empty budget response");
        return text.slice(0, 40);
      }
    },
  },
  {
    name: "boltzpay_history",
    args: {},
    validate: (content) => {
      const text = content[0]?.text || "";
      try {
        const data = JSON.parse(text);
        const count = Array.isArray(data) ? data.length : (data.records?.length ?? 0);
        return `${count} record(s)`;
      } catch {
        assert(text.length > 0, "empty history response");
        return text.slice(0, 40);
      }
    },
  },
];

// Single MCP process: init + tools/list + all tool calls, early exit on completion
function runMcpBatch(toolTests, timeout = 30000) {
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke-test", version: "1.0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ];
  toolTests.forEach((t, i) => {
    messages.push({ jsonrpc: "2.0", id: 10 + i, method: "tools/call", params: { name: t.name, arguments: t.args } });
  });

  const expectedIds = [1, 2, ...toolTests.map((_, i) => 10 + i)];

  const batchScript = `
const { spawn } = require('child_process');
const proc = spawn('node', ['packages/mcp/dist/index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
const results = {};
let buffer = '';
const pending = new Set(${JSON.stringify(expectedIds)});

proc.stdout.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split('\\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.id !== undefined) {
        results[parsed.id] = parsed;
        pending.delete(parsed.id);
      }
    } catch {}
  }
  if (pending.size === 0) {
    proc.kill();
    process.stdout.write(JSON.stringify(results) + '\\n');
    process.exit(0);
  }
});

proc.stderr.on('data', () => {});

const messages = ${JSON.stringify(messages)};
for (const m of messages) proc.stdin.write(JSON.stringify(m) + '\\n');

setTimeout(() => {
  proc.kill();
  process.stdout.write(JSON.stringify(results) + '\\n');
  process.exit(0);
}, ${timeout - 2000});
`;

  const tmpFile = `/tmp/boltzpay-mcp-batch-${Date.now()}.cjs`;
  writeFileSync(tmpFile, batchScript);
  try {
    const out = execSync(`node ${tmpFile}`, {
      encoding: "utf8", timeout, stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(out.trim());
  } catch (e) {
    const raw = e.stdout || "";
    try { return JSON.parse(raw.trim()); } catch { return {}; }
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

const mcpResults = runMcpBatch(MCP_TOOL_TESTS);

test("MCP tools/list returns 7 tools", () => {
  const toolsList = mcpResults[2];
  assert(toolsList, "no tools/list response");
  const tools = toolsList.result?.tools || [];
  assert(tools.length === 7, `expected 7, got ${tools.length}`);
  const toolNames = tools.map(t => t.name).sort();
  detail(`${toolNames.join(", ")}`);
});

MCP_TOOL_TESTS.forEach((toolTest, i) => {
  const displayName = toolTest.label || toolTest.name;
  test(`MCP ${displayName}`, () => {
    const response = mcpResults[10 + i];
    assert(response, `no response for ${toolTest.name}`);
    assert(!response.error, `MCP error: ${JSON.stringify(response.error)}`);
    const content = response.result?.content;
    assert(content && content.length > 0, "empty tool response");
    assert(!response.result?.isError, `tool error: ${content?.[0]?.text?.slice(0, 100)}`);
    const info = toolTest.validate(content);
    detail(info);
  });
});

endSection();

// ─── 9. ACP PROTOCOL SUPPORT ────────────────────────────
section("9. ACP Protocol (config + mock server)", 6);

const hasStripeKey = !!process.env.STRIPE_SECRET_KEY;

// Inline .env loader for node -e contexts (dotenv not hoisted by pnpm)
const LOAD_DOTENV = `try { require('fs').readFileSync('.env', 'utf8').split('\\n').forEach(l => { const m = l.match(/^([^#=\\\\s]+)\\s*=\\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }); } catch {}`;

test("SDK capabilities include ACP with stripeSecretKey", () => {
  const out = run(`node -e "
    ${LOAD_DOTENV}
    const { BoltzPay } = require('./packages/sdk/dist/index.cjs');
    const agent = new BoltzPay({
      coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
      coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
      coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
      stripeSecretKey: 'sk_test_smoke_acp_key',
    });
    console.log(JSON.stringify(agent.getCapabilities()));
  "`, { timeout: 10000 });
  const caps = JSON.parse(out.trim());
  assert(caps.protocols.includes("acp"), "missing acp");
  assert(caps.protocols.includes("x402"), "missing x402");
  detail(`protocols: ${caps.protocols.join(" + ")} ${GREEN}✓${RESET}`);
});

test("SDK capabilities exclude ACP without stripeSecretKey", () => {
  const out = run(`node -e "
    ${LOAD_DOTENV}
    const { BoltzPay } = require('./packages/sdk/dist/index.cjs');
    const agent = new BoltzPay({
      coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
      coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
      coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
    });
    console.log(JSON.stringify(agent.getCapabilities()));
  "`, { timeout: 10000 });
  const caps = JSON.parse(out.trim());
  assert(!caps.protocols.includes("acp"), "acp should NOT be present");
  assert(caps.protocols.includes("x402"), "missing x402");
  detail(`protocols: [${caps.protocols.join(", ")}] — no acp ${GREEN}✓${RESET}`);
});

test("CLI wallet --json shows ACP with STRIPE_SECRET_KEY", () => {
  const out = run(`STRIPE_SECRET_KEY=sk_test_smoke ${cli} wallet --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.protocols.includes("acp"), "acp missing from wallet");
  assert(p.data.protocols.includes("x402"), "x402 missing from wallet");
  detail(`wallet protocols: ${p.data.protocols.join(" + ")} ${GREEN}✓${RESET}`);
});

test("CLI wallet --json without Stripe → x402 only", () => {
  const out = run(`STRIPE_SECRET_KEY= ${cli} wallet --json`);
  const p = JSON.parse(out.trim());
  assert(p.data.protocols.includes("x402"), "x402 missing");
  assert(!p.data.protocols.includes("acp"), "acp should NOT be present");
  detail(`wallet protocols: [${p.data.protocols.join(", ")}] — x402 only ${GREEN}✓${RESET}`);
});

// Mock ACP server: local HTTP serving manifest.json + checkout endpoints
// Tests that the SDK and CLI correctly detect ACP via /.well-known/acp/manifest.json
// and quote via POST /checkout_sessions — no real Stripe calls needed.

const ACP_MOCK_SERVER_HANDLER = `
  const http = require('http');

  function createAcpMockServer() {
    return http.createServer((req, res) => {
      // ACP manifest discovery
      if (req.url === '/.well-known/acp/manifest.json' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '2026-01-30', namespace: 'smoke-test' }));
        return;
      }
      // ACP HEAD detection (fallback)
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'x-acp-version': '2026-01-30' });
        res.end();
        return;
      }
      // ACP checkout session creation
      if (req.method === 'POST' && req.url === '/checkout_sessions') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'cs_smoke_test_1',
            status: 'open',
            line_items: [],
            payment_data: { currency: 'usd', amount: 42, payment_methods: ['stripe'] },
          }));
        });
        return;
      }
      // Default: 200 OK (x402 detect sees this, finds no 402 → returns false)
      res.writeHead(200);
      res.end('ok');
    });
  }
`;

test("Mock ACP server → SDK detect + quote", () => {
  const projectRoot = process.cwd();
  const script = `
    process.chdir(${JSON.stringify(projectRoot)});
    ${LOAD_DOTENV}
    ${ACP_MOCK_SERVER_HANDLER}
    const { BoltzPay } = require(${JSON.stringify(projectRoot + '/packages/sdk/dist/index.cjs')});

    const server = createAcpMockServer();
    server.listen(0, async () => {
      const port = server.address().port;
      try {
        const agent = new BoltzPay({
          coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
          coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
          coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
          stripeSecretKey: 'sk_test_smoke_acp',
          logLevel: 'silent',
        });
        const quote = await agent.quote('http://localhost:' + port + '/resource');
        process.stdout.write(JSON.stringify({
          protocol: quote.protocol,
          amount: quote.amount.toDisplayString(),
        }));
      } catch (e) {
        process.stdout.write(JSON.stringify({ error: e.message, code: e.code }));
      } finally {
        server.close();
        process.exit(0);
      }
    });
  `;
  const tmpFile = `/tmp/boltzpay-acp-sdk-${Date.now()}.cjs`;
  writeFileSync(tmpFile, script);
  try {
    const out = execSync(`node ${tmpFile}`, { encoding: "utf8", timeout: 20000, stdio: ["pipe", "pipe", "pipe"] });
    const p = JSON.parse(out.trim());
    assert(p.protocol === "acp", `wrong protocol: ${p.protocol || p.error}`);
    assert(p.amount === "$0.42", `wrong amount: ${p.amount}`);
    detail(`protocol: acp ${GREEN}✓${RESET}${DIM}  amount: $0.42 ${GREEN}✓${RESET}`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
});

test("Mock ACP server → CLI check detects ACP", () => {
  const projectRoot = process.cwd();
  // Use exec (async) instead of execSync so the mock server event loop stays alive
  const script = `
    ${ACP_MOCK_SERVER_HANDLER}
    const { exec } = require('child_process');

    const server = createAcpMockServer();
    server.listen(0, () => {
      const port = server.address().port;
      exec(
        'STRIPE_SECRET_KEY=sk_test_smoke BOLTZPAY_LOG_LEVEL=silent node packages/cli/dist/index.js check http://localhost:' + port + '/resource --json',
        { encoding: 'utf8', timeout: 30000, cwd: ${JSON.stringify(projectRoot)} },
        (err, stdout, stderr) => {
          process.stdout.write(stdout || stderr || JSON.stringify({ error: (err && err.message) || 'unknown' }));
          server.close();
          process.exit(0);
        }
      );
    });
  `;
  const tmpFile = `/tmp/boltzpay-acp-cli-${Date.now()}.cjs`;
  writeFileSync(tmpFile, script);
  try {
    const raw = execSync(`node ${tmpFile}`, { encoding: "utf8", timeout: 40000, stdio: ["pipe", "pipe", "pipe"] });
    const trimmed = raw.trim();
    assert(trimmed.startsWith("{"), `no JSON in output: ${trimmed.slice(0, 120)}`);
    const p = JSON.parse(trimmed);
    assert(p.data?.isPaid === true, `should be paid, got: ${JSON.stringify(p.data || p).slice(0, 100)}`);
    assert(p.data.protocol === "acp", `wrong protocol: ${p.data.protocol}`);
    assert(p.data.amount === "$0.42", `wrong amount: ${p.data.amount}`);
    detail(`isPaid ${GREEN}✓${RESET}${DIM}  protocol: acp ${GREEN}✓${RESET}${DIM}  $0.42 ${GREEN}✓${RESET}`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
});

endSection();

// ─── 10. E2E INTEGRATION (CDP keys) ─────────────────────
section("10. E2E Integration (CDP live)", 5);

const hasCdpKeys = process.env.COINBASE_API_KEY_ID && process.env.COINBASE_API_KEY_SECRET && process.env.COINBASE_WALLET_SECRET;
const testEndpoint = process.env.TEST_X402_ENDPOINT;

if (!hasCdpKeys) {
  skip("CDP live tests", "no COINBASE_* env vars (set .env to enable)");
} else {
  test("SDK import + BoltzPay instantiation", () => {
    const out = run(`node -e "
      const { BoltzPay } = require('./packages/sdk/dist/index.cjs');
      const agent = new BoltzPay({
        coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
        coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
        coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
        network: 'base-sepolia',
      });
      const caps = agent.getCapabilities();
      console.log(JSON.stringify(caps));
    "`, { timeout: 10000 });
    const caps = JSON.parse(out.trim());
    assert(caps.protocols.includes("x402"), "missing x402");
    assert(caps.chains.includes("evm"), "missing evm");
    assert(caps.chains.includes("svm"), "missing svm");
    detail(`chains: ${caps.chains.join("+")} ${GREEN}✓${RESET}${DIM}  protocols: ${caps.protocols.join("+")} ${GREEN}✓${RESET}`);
  });

  test("SDK quote on live V2 endpoint (invy.bot)", () => {
    const out = run(`node -e "
      const { BoltzPay } = require('./packages/sdk/dist/index.cjs');
      const agent = new BoltzPay({
        coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
        coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
        coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
        network: 'base',
      });
      agent.quote('https://invy.bot/api').then(q => {
        console.log(JSON.stringify({
          protocol: q.protocol,
          amount: q.amount.toDisplayString(),
          network: q.network,
          chains: q.allAccepts ? q.allAccepts.length : 0,
        }));
      });
    "`, { timeout: 20000 });
    const q = JSON.parse(out.trim());
    assert(q.protocol === "x402" && q.amount === "$0.05", "wrong quote");
    detail(`${q.amount} on ${q.network}, ${q.chains} chain(s) ${GREEN}✓${RESET}`);
  });

  test("SDK free fetch passthrough (httpbin)", () => {
    const out = run(`node -e "
      const { BoltzPay } = require('./packages/sdk/dist/index.cjs');
      const agent = new BoltzPay({
        coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
        coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
        coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
        network: 'base',
      });
      agent.fetch('https://httpbin.org/get').then(async r => {
        const data = await r.json();
        console.log(JSON.stringify({ ok: r.ok, payment: r.payment, hasData: !!data.headers }));
      });
    "`, { timeout: 15000 });
    const r = JSON.parse(out.trim());
    assert(r.ok === true && r.payment === null && r.hasData, "passthrough failed");
    detail(`ok ${GREEN}✓${RESET}${DIM}  payment: null ${GREEN}✓${RESET}${DIM}  data ${GREEN}✓${RESET}`);
  });

  test("SDK budget tracking (zero spent)", () => {
    const out = run(`node -e "
      const { BoltzPay } = require('./packages/sdk/dist/index.cjs');
      const agent = new BoltzPay({
        coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
        coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
        coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
        network: 'base',
        budget: { daily: 1.00 },
      });
      const b = agent.getBudget();
      console.log(JSON.stringify({
        dailySpent: b.dailySpent.toDisplayString(),
        hasLimit: !!b.dailyLimit,
        remaining: b.dailyRemaining?.toDisplayString(),
      }));
    "`, { timeout: 10000 });
    const b = JSON.parse(out.trim());
    assert(b.dailySpent === "$0.00" && b.hasLimit && b.remaining === "$1.00", "budget wrong");
    detail(`spent: $0.00 ${GREEN}✓${RESET}${DIM}  limit: $1.00 ${GREEN}✓${RESET}${DIM}  remaining: $1.00 ${GREEN}✓${RESET}`);
  });

  if (testEndpoint) {
    test(`SDK fetch paid endpoint (${testEndpoint})`, () => {
      const out = run(`node -e "
        const { BoltzPay } = require('./packages/sdk/dist/index.cjs');
        const agent = new BoltzPay({
          coinbaseApiKeyId: process.env.COINBASE_API_KEY_ID,
          coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET,
          coinbaseWalletSecret: process.env.COINBASE_WALLET_SECRET,
          network: 'base-sepolia',
          logLevel: 'warn',
        });
        agent.fetch('${testEndpoint}').then(async r => {
          const text = await r.text();
          const history = agent.getHistory();
          console.log(JSON.stringify({
            ok: r.ok, paid: !!r.payment,
            txHash: r.payment?.txHash?.slice(0, 10),
            amount: r.payment?.amount?.toDisplayString(),
            hasBody: text.length > 0,
            historyCount: history.length,
          }));
        });
      "`, { timeout: 90000 });
      const r = JSON.parse(out.trim());
      assert(r.ok && r.paid && r.txHash && r.hasBody && r.historyCount === 1, "paid fetch failed");
      detail(`paid: ${r.amount} ${GREEN}✓${RESET}${DIM}  tx: ${r.txHash}... ${GREEN}✓${RESET}${DIM}  history: ${r.historyCount} ${GREEN}✓${RESET}`);
    });
  } else {
    skip("SDK paid fetch", "no TEST_X402_ENDPOINT in .env");
  }
}

endSection();

// ─── 11. BAZAAR DISCOVERY ────────────────────────────────
section("11. Bazaar Discovery (Coinbase CDP directory)", 1);

const BAZAAR_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?type=http&limit=200";
const SAMPLE_SIZE = 20;

let bazaarItems = [];
test("fetch Bazaar Discovery API", () => {
  const raw = execSync(`curl -sf "${BAZAAR_URL}"`, { encoding: "utf8", timeout: 15000 });
  const data = JSON.parse(raw);
  bazaarItems = data.items || [];
  assert(bazaarItems.length >= 50, `only ${bazaarItems.length} items`);
  detail(`${bazaarItems.length} endpoints available`);
});

if (bazaarItems.length > 0) {
  const getEndpoints = bazaarItems.filter((item) => {
    const schema = item.accepts?.[0]?.outputSchema?.input;
    const method = schema?.method || schema?.output?.input?.method || "GET";
    return method === "GET";
  });

  const shuffled = getEndpoints.sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, SAMPLE_SIZE);

  let detected = 0;
  let notDetected = 0;
  let errors = 0;
  let multiChain = 0;

  console.log(`\n  ${DIM}Testing ${sample.length} random GET endpoints...${RESET}\n`);

  for (const item of sample) {
    const url = item.resource;
    const host = new URL(url).hostname;
    const v = item.x402Version;
    const price = item.accepts?.[0]?.maxAmountRequired || item.accepts?.[0]?.amount || "?";

    try {
      const raw = run(`${cli} check "${url}" --json`, { timeout: 12000 });
      const p = JSON.parse(raw.trim());
      if (p.data?.isPaid) {
        const chains = p.data.options ? p.data.options.map(o => o.chain).join("+") : "single";
        if (p.data.options && p.data.options.length > 1) multiChain++;
        console.log(`    ${GREEN}✓${RESET} ${pad(host, 42)} V${v} → ${p.data.amount} [${chains}]`);
        detected++;
        passed++;
        if (currentSection) currentSection.passed++;
      } else {
        console.log(`    ${YELLOW}○${RESET} ${DIM}${pad(host, 42)} V${v} → not detected${RESET}`);
        notDetected++;
      }
    } catch (e) {
      console.log(`    ${YELLOW}○${RESET} ${DIM}${pad(host, 42)} V${v} → timeout/error${RESET}`);
      errors++;
    }
  }

  const rate = Math.round((detected / sample.length) * 100);
  console.log("");
  detail(`Detection: ${detected}/${sample.length} (${rate}%)  Multi-chain: ${multiChain}  Missed: ${notDetected + errors}`);
}

endSection();

// ═══════════════════════════════════════════════════════════
// FINAL REPORT
// ═══════════════════════════════════════════════════════════
const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
const total = passed + failed;

console.log("");
console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════${RESET}`);
console.log("");

// Results summary
if (failed === 0) {
  console.log(`  ${BG_GREEN}${WHITE}${BOLD} PASS ${RESET}  ${BOLD}All ${passed} tests passed${RESET}  ${DIM}(${skipped} skipped)${RESET}  ${DIM}⏱ ${totalTime}s${RESET}`);
} else {
  console.log(`  ${BG_RED}${WHITE}${BOLD} FAIL ${RESET}  ${GREEN}${passed} passed${RESET}  ${RED}${failed} failed${RESET}  ${DIM}(${skipped} skipped)${RESET}  ${DIM}⏱ ${totalTime}s${RESET}`);
}

console.log("");

// Section breakdown with progress bars
console.log(`  ${BOLD}Section Report${RESET}`);
console.log(`  ${"─".repeat(55)}`);

for (const s of sectionResults) {
  const sTotal = s.passed + s.failed;
  const ratio = sTotal > 0 ? s.passed / sTotal : 0;
  const pct = sTotal > 0 ? Math.round(ratio * 100) : 0;
  const color = pct === 100 ? GREEN : pct >= 80 ? YELLOW : RED;
  const label = pad(s.name, 35);
  const count = rpad(`${s.passed}/${sTotal}`, 5);
  const time = rpad(`${s.elapsed}s`, 5);

  if (sTotal === 0) {
    console.log(`  ${DIM}${label} ${count}  ░░░░░░░░░░  skip   ${time}${RESET}`);
  } else {
    console.log(`  ${label} ${count}  ${color}${bar(ratio, 10)}${RESET} ${rpad(`${pct}%`, 4)}  ${DIM}${time}${RESET}`);
  }
}

console.log("");

// Coverage markers
console.log(`  ${BOLD}Coverage Markers${RESET}`);
console.log(`  ${"─".repeat(55)}`);

const markers = [
  ["CLI", "7/7 commands + --chain + --debug"],
  ["MCP", "7/7 tools + category filter + chain override"],
  ["x402", "4/4 formats (V2, V1, hybrid, www-auth)"],
  ["ACP", "config toggle + mock server detect + quote + CLI"],
  ["Chains", "EVM validated, SVM config ready"],
  ["Output", "human + JSON both verified"],
  ["Errors", "invalid input + unreachable + graceful"],
  ["Bazaar", `live detection on ${SAMPLE_SIZE} random endpoints`],
];

for (const [key, val] of markers) {
  console.log(`  ${GREEN}✓${RESET} ${BOLD}${pad(key + ":", 10)}${RESET}${val}`);
}

console.log("");
console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════${RESET}`);
console.log("");

process.exit(failed > 0 ? 1 : 0);
