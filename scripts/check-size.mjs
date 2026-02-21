import { execSync } from "node:child_process";
import { statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const BYTES_PER_KB = 1024;
const MAX_SIZE_BYTES = 500 * BYTES_PER_KB;
const PACKAGES = ["core", "protocols", "sdk", "mcp", "cli"];

function extractTarballName(output) {
  const lines = output.trim().split("\n");
  const tgzLine = lines.find((line) => line.trim().endsWith(".tgz"));
  return tgzLine ? tgzLine.trim() : lines[lines.length - 1].trim();
}

let failed = false;

for (const pkg of PACKAGES) {
  const dir = join(process.cwd(), "packages", pkg);
  const output = execSync("pnpm pack --pack-destination .", {
    cwd: dir,
    encoding: "utf8",
  });
  const tarball = extractTarballName(output);
  const tarPath = join(dir, tarball);
  const size = statSync(tarPath).size;
  unlinkSync(tarPath);

  const sizeKB = (size / BYTES_PER_KB).toFixed(1);
  const icon = size > MAX_SIZE_BYTES ? "\u2717" : "\u2713";

  process.stdout.write(`  ${icon} @boltzpay/${pkg} \u2014 ${sizeKB}KB\n`);

  if (size > MAX_SIZE_BYTES) {
    failed = true;
  }
}

if (failed) {
  process.stderr.write(
    "\nPackage size check FAILED. Maximum allowed: 500KB per package.\n",
  );
  process.exit(1);
} else {
  process.stdout.write("\nAll packages within size limit.\n");
}
