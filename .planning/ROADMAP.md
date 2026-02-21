# Roadmap: BoltzPay Phase A — Open Source SDK

## Overview

BoltzPay Phase A transforms the existing SaaS codebase into a pure open source SDK that lets AI agents pay for API endpoints automatically. The journey starts by cleaning the SaaS coupling from existing code, then builds the SDK composition root with full protocol support, adds the MCP server and CLI for distribution, hardens everything with a bulletproof build pipeline, creates the landing page and documentation, and ends with a coordinated npm publish and public launch. Every phase delivers a coherent, testable capability that the next phase builds on.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation Cleanup** - Remove SaaS coupling, upgrade deps, restructure monorepo for SDK architecture (completed 2026-02-17)
- [ ] **Phase 2: SDK Core** - Build BoltzPay class with fetch/quote/budget/events/history and full protocol support
- [x] **Phase 3: MCP Server & CLI** - Ship @boltzpay/mcp and @boltzpay/cli as npx-runnable packages (completed 2026-02-18)
- [x] **Phase 4: Build Pipeline & CI** - ESM+CJS dual build, CI pipeline, npm publish workflow with provenance (completed 2026-02-18)
- [x] **Phase 5: Documentation & Landing Page** - README, examples, CONTRIBUTING, Astro landing page (completed 2026-02-18)
- [x] **Phase 6: Integrations** - LangChain, CrewAI, Vercel AI SDK integrations + compatible APIs directory (completed 2026-02-20)
- [ ] **Phase 7: Launch** - Coordinated npm publish, Show HN, social media, community posts

## Phase Details

### Phase 1: Foundation Cleanup
**Goal**: Developers building on the codebase work with clean, SaaS-free domain interfaces and a modern toolchain
**Depends on**: Nothing (first phase)
**Requirements**: MONO-01, MONO-02, MONO-03, MONO-04, MONO-05, MONO-06, MONO-07, MONO-08, PROTO-07
**Success Criteria** (what must be TRUE):
  1. `grep -r "WalletId|UserId|AgentId" packages/` returns zero results (SaaS types fully removed)
  2. `pnpm build` succeeds across all active workspace packages with zero errors
  3. All existing tests pass after restructure (adapted to new interfaces, not deleted)
  4. packages/db, packages/ui, and SaaS apps/web code are removed from active workspace
  5. Vitest 4, Biome 2, pnpm 10, and MCP SDK 1.26+ are installed and working
**Plans**: 5 plans
- [ ] 01-01-PLAN.md — Delete SaaS packages and clean root configs
- [ ] 01-02-PLAN.md — Adapt core domain types to SDK-friendly interfaces
- [ ] 01-03-PLAN.md — Upgrade toolchain (pnpm 10, Vitest 4, Biome 2, TS 5.8)
- [ ] 01-04-PLAN.md — Adapt protocol adapters and tests to SDK interfaces
- [ ] 01-05-PLAN.md — Scaffold CLI + landing, clean skeletons, final verification

### Phase 2: SDK Core
**Goal**: A developer can `npm install @boltzpay/sdk`, create a BoltzPay instance, and use `agent.fetch(url)` to automatically detect and pay x402 and ACP endpoints
**Depends on**: Phase 1
**Requirements**: SDK-01, SDK-02, SDK-03, SDK-04, SDK-05, SDK-06, SDK-07, SDK-08, SDK-09, SDK-10, SDK-11, SDK-12, SDK-13, SDK-14, SDK-15, SDK-16, SDK-17, SDK-18, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, PROTO-01, PROTO-02, PROTO-03, PROTO-04, PROTO-05, PROTO-06, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08, TEST-09, TEST-10, TEST-11, TEST-12, TEST-13, TEST-15, TEST-16, TEST-17, TEST-19, TEST-20, TEST-21
**Success Criteria** (what must be TRUE):
  1. `new BoltzPay({})` creates a working read-only instance; adding Coinbase credentials enables payments
  2. `agent.fetch(url)` on a free endpoint returns data with zero payment overhead (passthrough)
  3. `agent.fetch(url)` on an x402 endpoint detects the 402 response, pays via EIP-712 signing, and returns the data
  4. `agent.fetch(url)` with budget limits refuses payment and throws BudgetExceededError when any limit is exceeded
  5. `agent.on('payment', cb)` fires after successful payment with protocol, amount, and URL details
**Plans**: 7 plans
- [ ] 02-01-PLAN.md — Error hierarchy, stderr logger, and Zod config validation
- [ ] 02-02-PLAN.md — Budget manager, event system, payment history, and response wrapper
- [ ] 02-03-PLAN.md — BoltzPay class (composition root) and barrel exports
- [ ] 02-04-PLAN.md — ACP adapter full implementation (detect, quote, execute)
- [ ] 02-05-PLAN.md — Unit tests for SDK components (errors, config, budget, events, history, client)
- [ ] 02-06-PLAN.md — ACP adapter tests and SDK functional tests (fetch flow, budget, maxAmount)
- [ ] 02-07-PLAN.md — Integration and E2E tests on Base Sepolia testnet

### Phase 3: MCP Server & CLI
**Goal**: Non-dev users can add BoltzPay to Claude Desktop via `npx @boltzpay/mcp`, and developers can use `npx @boltzpay/cli fetch <url>` from the terminal
**Depends on**: Phase 2
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06, MCP-07, MCP-08, CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, TEST-14, TEST-18, TEST-22
**Success Criteria** (what must be TRUE):
  1. `npx @boltzpay/mcp` starts an MCP server that registers 7 tools and communicates via stdio without stdout pollution
  2. Claude Desktop can call `boltzpay_fetch` tool and receive paid endpoint data
  3. `npx @boltzpay/cli fetch <url>` outputs paid endpoint data to stdout in human-readable format
  4. `npx @boltzpay/cli fetch <url> --json` outputs structured JSON for machine consumption (Python bridge)
  5. Both MCP and CLI read credentials from environment variables (COINBASE_API_KEY_ID, etc.)
**Plans**: 4 plans
Plans:
- [x] 03-01-PLAN.md — MCP server core with all 7 tools, config, and error handling
- [x] 03-02-PLAN.md — CLI package with all 7 commands, rich output, and JSON mode
- [x] 03-03-PLAN.md — MCP setup command + MCP tests (unit, functional, E2E)
- [x] 03-04-PLAN.md — CLI unit tests (commands, formatters, error handling)

### Phase 4: Build Pipeline & CI
**Goal**: Every push triggers automated quality gates, and packages are ready for npm publish with provenance and correct ESM+CJS exports
**Depends on**: Phase 3
**Requirements**: BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-05, BUILD-06, BUILD-07, BUILD-08, BUILD-09
**Success Criteria** (what must be TRUE):
  1. `import { BoltzPay } from '@boltzpay/sdk'` (ESM) and `const { BoltzPay } = require('@boltzpay/sdk')` (CJS) both work correctly
  2. `publint` and `are-the-types-wrong --pack` pass with zero errors for sdk, mcp, and cli packages
  3. GitHub Actions CI runs test + lint + typecheck + build + publint + attw on every push
  4. `npm pack` produces packages under 500KB each with correct exports field
  5. Changesets workflow generates CHANGELOG entries and automates version bumps
**Plans**: 4 plans
Plans:
- [ ] 04-01-PLAN.md — Fix package.json exports and tsup configs for dual ESM+CJS build
- [ ] 04-02-PLAN.md — Set up Changesets with lockstep versioning
- [ ] 04-03-PLAN.md — Install publint + attw validation and package size checks
- [ ] 04-04-PLAN.md — Create GitHub Actions CI and Release workflows

### Phase 04.1: Multi-chain multi-protocol SDK hardening (INSERTED)

**Goal:** Harden the SDK to support multi-chain (Base + Solana) and multi-protocol (x402 + ACP) with intelligent routing, multi-accept negotiation, and coherent UX across wallet/balance/quote/history/errors/CLI/MCP
**Depends on:** Phase 4
**Requirements:** MULTI-CHAIN-01, MULTI-CHAIN-02, MULTI-CHAIN-03, MULTI-CHAIN-04, MULTI-CHAIN-05, MULTI-CHAIN-06, MULTI-CHAIN-07, MULTI-CHAIN-08, MULTI-CHAIN-09, MULTI-CHAIN-10, MULTI-CHAIN-11, MULTI-CHAIN-12, MULTI-CHAIN-13, MULTI-CHAIN-14, MULTI-CHAIN-15
**Plans:** 7/7 plans complete

Plans:
- [ ] 04.1-01-PLAN.md — Core domain types (ChainNamespace, NetworkIdentifier, AcceptOption) + selectBestAccept TDD
- [ ] 04.1-02-PLAN.md — CdpWalletManager dual-account (EVM+Solana) + CdpSvmSigner adapter
- [ ] 04.1-03-PLAN.md — X402Adapter multi-chain (EVM+SVM schemes, allAccepts passthrough)
- [ ] 04.1-04-PLAN.md — AcpAdapter manifest.json detection + ProtocolRouter multi-adapter fallback
- [ ] 04.1-05-PLAN.md — SDK composition (BoltzPay config, getCapabilities, getBalances, chain selection, fallback)
- [ ] 04.1-06-PLAN.md — CLI + MCP chain-aware UX (wallet, check, fetch --chain, history)
- [ ] 04.1-07-PLAN.md — Integration tests + full pipeline verification

### Phase 5: Documentation & Landing Page
**Goal**: A developer landing on the GitHub repo or website understands what BoltzPay does in 10 seconds and has a working setup in under 2 minutes
**Depends on**: Phase 4
**Requirements**: DX-01, DX-02, DX-03, DX-04, DX-05, DX-06, LAND-01, LAND-02, LAND-03, LAND-04, LAND-05, LAND-06, LAND-07, LAND-08
**Success Criteria** (what must be TRUE):
  1. README has a 3-line quickstart code block, CI/npm/license/types badges, and a protocol comparison table
  2. `examples/` directory contains runnable examples for basic-usage, with-budget, with-mcp, and with-langchain
  3. Astro landing page is deployed with hero code block, protocol table, MCP section, and GitHub-first design (no SaaS vibes)
  4. CONTRIBUTING.md, CHANGELOG.md, and MIT LICENSE exist in repo root and every published package
**Plans**: 5 plans
Plans:
- [ ] 05-01-PLAN.md — Repo docs (LICENSE, CONTRIBUTING, CHANGELOG, package.json metadata)
- [ ] 05-02-PLAN.md — README with full content (badges, quickstarts, protocol table, MCP)
- [ ] 05-03-PLAN.md — Examples directory (5 runnable examples)
- [ ] 05-04-PLAN.md — Landing page setup + core sections (Hero, ProtocolTable, MCP, Features)
- [ ] 05-05-PLAN.md — Landing page remaining sections (HowItWorks, Footer) + llms.txt files

### Phase 6: Integrations
**Goal**: Developers using LangChain, CrewAI, or Vercel AI SDK can add BoltzPay as a tool in under 5 lines of code
**Depends on**: Phase 4
**Requirements**: INT-01, INT-02, INT-03, INT-04
**Success Criteria** (what must be TRUE):
  1. LangChain Python `BoltzPayFetchTool` works by calling `npx @boltzpay/cli` as a subprocess and returns paid data
  2. CrewAI Python `BoltzPayTool` works by calling CLI subprocess and integrates with CrewAI agent workflow
  3. Vercel AI SDK TypeScript tool wraps `@boltzpay/sdk` directly and works with `generateText()`
  4. Compatible APIs directory lists at least 5 third-party x402 endpoints with descriptions and pricing
**Plans**: 5 plans
Plans:
- [ ] 06-01-PLAN.md — Vercel AI SDK integration (@boltzpay/ai-sdk)
- [ ] 06-02-PLAN.md — LangChain Python integration (boltzpay-langchain)
- [ ] 06-03-PLAN.md — CrewAI integration (MCP guide + boltzpay-crewai) + OpenClaw skill
- [ ] 06-04-PLAN.md — n8n custom node (@boltzpay/n8n-nodes-boltzpay)
- [ ] 06-05-PLAN.md — API Directory enrichment + Bazaar Discovery integration

### Phase 7: Launch
**Goal**: BoltzPay is published on npm/PyPI/ClawHub, visible on Hacker News, Twitter, Reddit, and Discord, with all distribution channels (core SDK + integration packages) active simultaneously
**Depends on**: Phase 5, Phase 6
**Requirements**: LAUNCH-01, LAUNCH-02, LAUNCH-03, LAUNCH-04, LAUNCH-05, LAUNCH-06, LAUNCH-07, LAUNCH-08, LAUNCH-09, LAUNCH-10, LAUNCH-11, LAUNCH-12, LAUNCH-13, LAUNCH-14, LAUNCH-15, LAUNCH-16, LAUNCH-17, LAUNCH-18, LAUNCH-19
**Success Criteria** (what must be TRUE):
  1. `npm install @boltzpay/sdk`, `@boltzpay/mcp`, `@boltzpay/cli`, and `@boltzpay/ai-sdk` install from npm with provenance attestation
  2. `pip install langchain-boltzpay` and `pip install boltzpay-crewai` install from PyPI and work end-to-end
  3. n8n community node `@boltzpay/n8n-nodes-boltzpay` is discoverable in n8n
  4. OpenClaw skill is published and installable on ClawHub
  5. Show HN post is live with working links to GitHub repo, npm packages, and landing page
  6. Twitter/X thread, Reddit posts, and Discord community posts are published on launch day
  7. Root README has "Framework Integrations" section covering all integration packages
  8. All public links (npm, PyPI, GitHub, landing page, docs, examples) are live and working
**Plans**: 6 plans
Plans:
- [ ] 07-01-PLAN.md — Package name verification + n8n workspace integration
- [ ] 07-02-PLAN.md — CI/CD hardening (Python tests, PyPI publish, Renovate)
- [ ] 07-03-PLAN.md — Per-package README polish + root README integrations update
- [ ] 07-04-PLAN.md — Social content drafts (Show HN, Twitter, Reddit, Discord)
- [ ] 07-05-PLAN.md — Coordinated publish day (David + Claude)
- [ ] 07-06-PLAN.md — Post-publish polish (badges, social handoff, deferred items)

**Note:** LAUNCH-16 through LAUNCH-19 are deferred (post-launch, when traction). LAUNCH-06 is a reminder only. APIs payantes by BoltzPay = separate repo, after Phase A launch.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7
Note: Phase 5 and Phase 6 can execute in parallel after Phase 4. Phase 7 depends on both.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation Cleanup | 5/5 | Complete    | 2026-02-17 |
| 2. SDK Core | 7/7 | Complete    | 2026-02-18 |
| 3. MCP Server & CLI | 4/4 | Complete    | 2026-02-18 |
| 4. Build Pipeline & CI | 4/4 | Complete    | 2026-02-18 |
| 4.1 Multi-Chain Hardening | 7/7 | Complete    | 2026-02-18 |
| 5. Documentation & Landing Page | 5/5 | Complete    | 2026-02-18 |
| 6. Integrations | 0/5 | Complete    | 2026-02-20 |
| 7. Launch | 3/6 | In Progress | - |

---
*Roadmap created: 2026-02-17*
*Last updated: 2026-02-21 — Phase 7 plan 4/6 complete (social content drafts)*
