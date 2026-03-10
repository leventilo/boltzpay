# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-03-10

### Added

- Configurable per-phase timeouts (detect, quote, payment) with sensible defaults
- Payment-safe retry engine — automatic retry for transient failures, never retries after payment
- Structured NDJSON logging via `logger` option for observability
- Pluggable storage adapters (`MemoryAdapter`, `FileAdapter`) with async interface
- Payment metrics via `getMetrics()` (total spent, count, success rate)
- Payment history export via `exportHistory()` (JSON/CSV)
- Endpoint diagnostics — `diagnose(url)` performs deep health checks (DNS, GET, POST, headers) in under 2s
- Allowlist/blocklist for domain-level payment control
- `maxAmount` guard — hard ceiling on any single payment
- Dry-run mode — simulate full payment flow without spending
- Multi-wallet routing — automatic wallet selection based on protocol detection
- Stellar chain namespace support in core
- `verify-directory` CLI command for batch endpoint health checks
- `diagnose` command added to CLI, MCP, AI-SDK, n8n, LangChain, CrewAI
- n8n integration expanded from 4 to 8 operations (+diagnose, budget, history, wallet)
- Directory curated to 48 verified endpoints (42 x402 + 6 L402)

## [0.1.2] - 2026-02-28

### Changed

- Dynamic API directory — loads from GitHub at runtime with 5-min cache, static fallback
- Updated all x402 packages to ^2.6.0
- Release workflow uses dedicated RELEASE_TOKEN for branch-protected pushes

## [0.1.1] - 2026-02-20

### Changed

- Polished READMEs, badges, and package descriptions
- Replaced Changesets with one-click `workflow_dispatch` release workflow
- Added CLI demo GIF and site analytics

## [0.1.0] - 2026-02-18

### Added

- BoltzPay SDK (`@boltzpay/sdk`) with `agent.fetch()` automatic payment
- Multi-protocol support: x402 (USDC, Base + Solana) and L402 (Bitcoin Lightning)
- Multi-chain support: EVM (Base mainnet + testnet) and SVM (Solana)
- Budget management with daily and per-transaction limits
- Payment events system (payment, budget:warning, budget:exceeded, error)
- Payment history tracking
- Zero-config explore mode (check, quote, discover without credentials)
- MCP server (`@boltzpay/mcp`) with 8 tools for Claude Desktop
- CLI (`@boltzpay/cli`) with 8 commands and JSON output mode
- API directory with 48 verified endpoints
- ESM + CJS dual build for library packages (core, protocols, sdk); ESM-only for executables (mcp, cli)
- GitHub Actions CI pipeline
