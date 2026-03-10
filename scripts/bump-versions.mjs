#!/usr/bin/env node

// Bumps all package versions across the monorepo (npm + PyPI + landing badge).
// Usage: node scripts/bump-versions.mjs <patch|minor|major>

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
	console.error("Usage: node scripts/bump-versions.mjs <patch|minor|major>");
	process.exit(1);
}

const root = process.cwd();

// --- Read current version from core (source of truth) ---

const corePkg = JSON.parse(
	readFileSync(join(root, "packages/core/package.json"), "utf-8"),
);
const current = corePkg.version;
const [maj, min, pat] = current.split(".").map(Number);

const next =
	bump === "major"
		? `${maj + 1}.0.0`
		: bump === "minor"
			? `${maj}.${min + 1}.0`
			: `${maj}.${min}.${pat + 1}`;

console.log(`\n  ${current} -> ${next} (${bump})\n`);

// --- npm packages ---

const npmPaths = [
	"packages/core/package.json",
	"packages/protocols/package.json",
	"packages/sdk/package.json",
	"packages/mcp/package.json",
	"packages/cli/package.json",
	"packages/ai-sdk/package.json",
	"packages/config/package.json",
	"integrations/n8n/package.json",
];

for (const rel of npmPaths) {
	const abs = join(root, rel);
	const pkg = JSON.parse(readFileSync(abs, "utf-8"));
	pkg.version = next;
	writeFileSync(abs, `${JSON.stringify(pkg, null, 2)}\n`);
	console.log(`  + ${rel}`);
}

// --- Python packages ---

const pyPaths = [
	"integrations/langchain/pyproject.toml",
	"integrations/crewai/pyproject.toml",
];

for (const rel of pyPaths) {
	const abs = join(root, rel);
	let content = readFileSync(abs, "utf-8");
	content = content.replace(
		/^version\s*=\s*"[^"]*"/m,
		`version = "${next}"`,
	);
	writeFileSync(abs, content);
	console.log(`  + ${rel}`);
}

// --- Landing page version badge ---

const headerPath = join(root, "apps/landing/src/components/Header.astro");
let header = readFileSync(headerPath, "utf-8");
const badgeRegex = /v[\d.]+\s+is live/;
if (badgeRegex.test(header)) {
	header = header.replace(badgeRegex, `v${next} is live`);
	writeFileSync(headerPath, header);
	console.log("  + apps/landing/src/components/Header.astro (badge)");
}

// --- Source code version strings ---

const sourceVersionFiles = [
	{ path: "packages/cli/src/program.ts", regex: /\.version\("[^"]*"\)/ , replacement: `.version("${next}")` },
	{ path: "packages/mcp/src/index.ts", regex: /version:\s*"[^"]*"/, replacement: `version: "${next}"` },
];

for (const { path: rel, regex, replacement } of sourceVersionFiles) {
	const abs = join(root, rel);
	let content = readFileSync(abs, "utf-8");
	if (regex.test(content)) {
		content = content.replace(regex, replacement);
		writeFileSync(abs, content);
		console.log(`  + ${rel} (source version)`);
	}
}

// --- GitHub Actions output ---

if (process.env.GITHUB_OUTPUT) {
	appendFileSync(process.env.GITHUB_OUTPUT, `new_version=${next}\n`);
	appendFileSync(process.env.GITHUB_OUTPUT, `old_version=${current}\n`);
}

console.log(`\n  Done. All packages: ${current} -> ${next}\n`);
