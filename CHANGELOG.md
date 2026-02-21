# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-18

### Added

- BoltzPay SDK (`@boltzpay/sdk`) with `agent.fetch()` automatic payment
- Multi-protocol support: x402 (USDC, Base + Solana) and L402 (Bitcoin Lightning)
- Multi-chain support: EVM (Base mainnet + testnet) and SVM (Solana)
- Budget management with daily and per-transaction limits
- Payment events system (payment, budget:warning, budget:exceeded, error)
- Payment history tracking
- Zero-config explore mode (check, quote, discover without credentials)
- MCP server (`@boltzpay/mcp`) with 7 tools for Claude Desktop
- CLI (`@boltzpay/cli`) with 7 commands and JSON output mode
- API directory with 11+ verified endpoints
- ESM + CJS dual build for library packages (core, protocols, sdk); ESM-only for executables (mcp, cli)
- GitHub Actions CI pipeline
