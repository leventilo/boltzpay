import { execSync } from "child_process";

const cli = "node packages/cli/dist/index.js";
const results = [];

// Get directory entries via CLI JSON
let entries;
try {
  const raw = execSync(`${cli} discover --json`, { encoding: "utf8", timeout: 5000 });
  entries = JSON.parse(raw.trim()).data;
} catch (e) {
  console.error("Failed to get directory:", e.message);
  process.exit(1);
}

console.log(`\nSMOKE TEST — ${entries.length} endpoints from boltzpay discover\n`);
console.log("─".repeat(80));

let passed = 0;
let failed = 0;
let down = 0;

for (const entry of entries) {
  const label = `${entry.name.padEnd(35)} ${entry.pricing.padEnd(10)}`;
  try {
    const raw = execSync(`${cli} check "${entry.url}" --json`, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parsed = JSON.parse(raw.trim());

    if (parsed.data?.isPaid) {
      console.log(`  ✅  ${label}  → ${parsed.data.protocol} ${parsed.data.amount}`);
      results.push({ name: entry.name, status: "paid", amount: parsed.data.amount });
      passed++;
    } else {
      console.log(`  ⚠️  ${label}  → FREE (expected paid)`);
      results.push({ name: entry.name, status: "free" });
      down++;
    }
  } catch (e) {
    const stderr = e.stderr?.toString() || "";
    const short = stderr.includes("fetch failed") ? "unreachable" : stderr.slice(0, 60).trim();
    console.log(`  ❌  ${label}  → ERROR: ${short || e.message.slice(0, 60)}`);
    results.push({ name: entry.name, status: "error", reason: short });
    failed++;
  }
}

console.log("─".repeat(80));
console.log(`\n  ✅ ${passed} detected as paid`);
if (down > 0) console.log(`  ⚠️  ${down} returned free (endpoint possibly down)`);
if (failed > 0) console.log(`  ❌ ${failed} errors`);
console.log(`  Total: ${entries.length}\n`);

process.exit(failed > 0 ? 1 : 0);
