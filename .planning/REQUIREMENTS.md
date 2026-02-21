# Requirements: BoltzPay Phase A — Open Source SDK

**Defined:** 2026-02-17
**Core Value:** `agent.fetch(url)` — your AI agent pays automatically, whatever the protocol.

## Engineering Constraints

All code must comply with `RULES.md`:
- **DDD strict** — core zero deps, domain logic in entities/VOs, no provider names in core
- **TypeScript strict** — zero `any`, zero `as` cast, zero `@ts-ignore`, `strict: true`
- **Clean code** — zero comments (except public API JSDoc), max 40 lines/function, no magic numbers
- **Money** — bigint cents only, Money VO for all arithmetic, no `number` for money
- **Error hierarchy** — typed errors by layer (DomainError, AdapterError, BoltzPayError)
- **Adversarial review** — security, invariants, DDD compliance, edge cases after each task
- **Context7** — verify lib docs before coding integrations

## v1 Requirements

### SDK Core

- [x] **SDK-01**: Developer can create a BoltzPay instance with optional Coinbase CDP credentials (read-only mode without keys, payment mode with keys)
- [x] **SDK-02**: Developer can optionally add Stripe credentials for ACP protocol support
- [x] **SDK-03**: `agent.fetch(url)` detects payment protocol automatically and pays transparently
- [x] **SDK-04**: `agent.fetch(url)` passes through free endpoints as a normal fetch (zero overhead)
- [x] **SDK-05**: `agent.fetch(url, { maxAmount })` refuses payment if quote exceeds specified max
- [x] **SDK-06**: `agent.quote(url)` returns cost and protocol without paying
- [x] **SDK-07**: Developer can set budget limits (daily, monthly, per-transaction) in constructor
- [x] **SDK-08**: SDK blocks payment when any budget limit is exceeded (BudgetExceededError)
- [x] **SDK-09**: `agent.getBudget()` returns current budget state (spent/remaining per period)
- [x] **SDK-10**: `agent.resetDailyBudget()` resets daily counter programmatically
- [x] **SDK-11**: `agent.getHistory()` returns in-memory list of payments made this session
- [x] **SDK-12**: Event system: `agent.on('payment', cb)` fires after each successful payment
- [x] **SDK-13**: Event system: `agent.on('budget:warning', cb)` fires at 80%+ budget usage
- [x] **SDK-14**: Event system: `agent.on('budget:exceeded', cb)` fires when payment blocked
- [x] **SDK-15**: Event system: `agent.on('error', cb)` fires on payment failures
- [x] **SDK-16**: Config validation via Zod with clear error messages on invalid/missing credentials
- [x] **SDK-17**: Debug logging configurable via `logLevel` option (debug/info/warn/error/silent)
- [x] **SDK-18**: All logging goes to stderr (not stdout, to avoid MCP stdio corruption)

### Error Handling

- [x] **ERR-01**: BoltzPayError base class with `code` (snake_case) and `statusCode` properties
- [x] **ERR-02**: ConfigurationError for missing/invalid credentials (missing_coinbase_credentials, invalid_config)
- [x] **ERR-03**: BudgetExceededError for limit violations (daily_budget_exceeded, monthly_budget_exceeded, per_transaction_exceeded)
- [x] **ERR-04**: ProtocolError for detection/payment failures (protocol_detection_failed, protocol_not_supported, payment_failed)
- [x] **ERR-05**: NetworkError for connectivity issues (network_timeout, endpoint_unreachable, blockchain_error)
- [x] **ERR-06**: InsufficientFundsError for wallet balance issues (insufficient_usdc, insufficient_stripe_balance)

### Protocols

- [x] **PROTO-01**: X402 full flow: detect HTTP 402 + payment-required header → quote → EIP-712 sign → pay → return data
- [x] **PROTO-02**: ACP full flow: detect ACP headers → quote → Stripe payment intent → pay → return data
- [x] **PROTO-03**: ProtocolRouter probes all adapters in parallel, first match wins
- [x] **PROTO-04**: Testnet support via `network: "base-sepolia"` config option
- [x] **PROTO-05**: USDC atomic unit conversion (6 decimals ↔ cents) via Money VO
- [x] **PROTO-06**: CdpManager provisions/reuses EVM account from user's CDP credentials (no DB lookup)
- [x] **PROTO-07**: Adapter interfaces accept credentials directly (no WalletId/UserId coupling)

### MCP Server

- [x] **MCP-01**: `@boltzpay/mcp` package installable and runnable via `npx @boltzpay/mcp`
- [x] **MCP-02**: Tool `boltzpay_fetch` — fetch paid endpoint, return data
- [x] **MCP-03**: Tool `boltzpay_quote` — check if endpoint is paid and how much, without paying
- [x] **MCP-04**: Tool `boltzpay_budget` — show remaining budget
- [x] **MCP-05**: Tool `boltzpay_history` — list recent payments
- [x] **MCP-06**: Configuration via environment variables (COINBASE_API_KEY_ID, COINBASE_API_KEY_SECRET, etc.)
- [x] **MCP-07**: Works in Claude Desktop and ChatGPT (stdio transport)
- [x] **MCP-08**: Zero stdout pollution (all logging to stderr)

### CLI

- [x] **CLI-01**: `@boltzpay/cli` package runnable via `npx @boltzpay/cli`
- [x] **CLI-02**: `boltzpay fetch <url>` — fetch paid endpoint, output data to stdout
- [x] **CLI-03**: `boltzpay quote <url>` — show cost without paying
- [x] **CLI-04**: `boltzpay budget` — show remaining budget
- [x] **CLI-05**: Configuration via environment variables (same as MCP)
- [x] **CLI-06**: JSON output mode (`--json`) for machine consumption (Python bridge)
- [x] **CLI-07**: Human-readable output by default

### Build & Publish

- [x] **BUILD-01**: ESM + CJS dual build via tsup for sdk, mcp, cli packages
- [x] **BUILD-02**: TypeScript declarations (.d.ts + .d.cts) exported correctly
- [x] **BUILD-03**: `publint` + `are-the-types-wrong` pass in CI
- [x] **BUILD-04**: npm publish with provenance (Sigstore attestation)
- [x] **BUILD-05**: Changesets for version management and CHANGELOG generation
- [x] **BUILD-06**: GitHub Actions CI: test + lint + typecheck + build on every push
- [x] **BUILD-07**: GitHub Actions release workflow: changesets → npm publish
- [x] **BUILD-08**: SemVer strict, starting at 0.1.0
- [x] **BUILD-09**: Package size validated (< 500KB per package)

### Developer Experience

- [x] **DX-01**: README with 3-line quickstart, badges (CI, npm, license, types), protocol table
- [x] **DX-02**: Examples directory: basic-usage, with-budget, with-mcp, with-langchain
- [x] **DX-03**: CONTRIBUTING.md with setup instructions and PR guidelines
- [x] **DX-04**: CHANGELOG.md following keep-a-changelog format
- [x] **DX-05**: MIT LICENSE file in repo root and every published package
- [x] **DX-06**: package.json metadata complete (description, keywords, homepage, repository, bugs)

### Integrations

- [x] **INT-01**: LangChain Python integration: BoltzPayFetchTool calling CLI subprocess
- [x] **INT-02**: CrewAI Python integration: BoltzPayTool calling CLI subprocess
- [x] **INT-03**: Vercel AI SDK TypeScript tool wrapping SDK
- [x] **INT-04**: Compatible APIs directory listing third-party x402 endpoints

### Landing Page

- [x] **LAND-01**: Astro 5.x static site deployed on Vercel/Cloudflare
- [x] **LAND-02**: Hero section with `agent.fetch()` code block and value prop
- [x] **LAND-03**: Protocol status table (x402 Live, ACP Live, AP2 Coming)
- [x] **LAND-04**: "Why open source" section with key benefits
- [x] **LAND-05**: MCP section for non-devs (zero code setup)
- [x] **LAND-06**: Compatible APIs section
- [x] **LAND-07**: GitHub-first design (Star button, npm install command prominent)
- [x] **LAND-08**: No SaaS vibes (no pricing, no sign up, no dashboard screenshots)

### Launch — Publish & Marketing

- [ ] **LAUNCH-01**: npm publish @boltzpay/sdk + @boltzpay/mcp + @boltzpay/cli simultaneously
- [x] **LAUNCH-02**: Show HN post prepared and submitted
- [x] **LAUNCH-03**: Twitter/X thread (educational: problem → solution → how to try)
- [x] **LAUNCH-04**: Reddit posts (r/programming, r/typescript, r/artificial, r/langchain)
- [x] **LAUNCH-05**: Discord community posts (LangChain, CrewAI, Vercel, Coinbase)
- [x] **LAUNCH-06**: Note: APIs payantes by BoltzPay = separate repo, end of Phase A (reminder only)

### Launch — Distribution (Integration Packages)

- [x] **LAUNCH-07**: Verify package naming conventions via Context7 + web search BEFORE any publish (npm: @boltzpay/ai-sdk, n8n naming; PyPI: langchain-boltzpay, boltzpay-crewai; ClawHub: skill name). Rename packages if conventions have changed since Phase 6.
- [ ] **LAUNCH-08**: npm publish `@boltzpay/ai-sdk` (Vercel AI SDK integration)
- [x] **LAUNCH-09**: npm publish `@boltzpay/n8n-nodes-boltzpay`, verify n8n community node discovery works after publish
- [x] **LAUNCH-10**: Set up PyPI account + API token, publish LangChain integration to PyPI via twine, verify `pip install` works
- [x] **LAUNCH-11**: Publish CrewAI integration to PyPI via twine, verify `pip install` works
- [ ] **LAUNCH-12**: Publish OpenClaw skill to ClawHub via `clawhub publish`, verify skill is installable

### Launch — Final Polish

- [x] **LAUNCH-13**: Root README "Framework Integrations" section with Python snippets (LangChain, CrewAI) + Vercel AI SDK + n8n mentions
- [x] **LAUNCH-14**: Post-publish verification: npm/PyPI badge links on integration READMEs, Colab link on LangChain notebook, n8n credential `documentationUrl` updated to boltzpay.ai docs
- [ ] **LAUNCH-15**: All public links verified live and working (npm packages, GitHub repo, landing page, Mintlify docs, examples)

### Launch — Community Visibility (post-launch, optional)

- [ ] **LAUNCH-16**: Submit PR to langchain-community (after PyPI traction)
- [ ] **LAUNCH-17**: Submit PR to crewai-tools (after PyPI traction)
- [ ] **LAUNCH-18**: Submit PR to n8n built-in nodes (after npm traction)
- [ ] **LAUNCH-19**: Post in Vercel AI SDK community/discussions

### Testing

- [x] **TEST-01**: Unit tests for Money VO (construction, operations, edge cases: zero, max, overflow)
- [x] **TEST-02**: Unit tests for DomainError hierarchy (typing, codes, inheritance)
- [x] **TEST-03**: Unit tests for BoltzPay client (config validation, constructor, methods)
- [x] **TEST-04**: Unit tests for budget enforcement (per-tx, daily, monthly limits, reset, edge: exact limit)
- [x] **TEST-05**: Unit tests for event system (payment, budget:warning, budget:exceeded, error)
- [x] **TEST-06**: Unit tests for payment history (add, cap at 100, getHistory)
- [x] **TEST-07**: Unit tests for BoltzPayError hierarchy (all error types, codes, statusCode)
- [x] **TEST-08**: Unit tests for X402Adapter (detect, quote, execute with mocked HTTP)
- [x] **TEST-09**: Unit tests for AcpAdapter (detect, quote, execute with mocked Stripe)
- [x] **TEST-10**: Unit tests for ProtocolRouter (parallel detection, first match, no match, fallback)
- [x] **TEST-11**: Unit tests for CdpManager (provision account, reuse, credential handling)
- [x] **TEST-12**: Unit tests for USDC conversion (atomic ↔ cents, edge cases)
- [x] **TEST-13**: Unit tests for config validation (valid config, missing fields, invalid types)
- [x] **TEST-14**: Unit tests for CLI commands (fetch, quote, budget, JSON output, error handling)
- [x] **TEST-15**: Functional tests for SDK fetch flow (mock HTTP: free endpoint → passthrough, x402 → detect+pay, ACP → detect+pay)
- [x] **TEST-16**: Functional tests for budget blocking (payment blocked when budget exceeded)
- [x] **TEST-17**: Functional tests for maxAmount guard (payment blocked when quote > maxAmount)
- [x] **TEST-18**: Functional tests for MCP server (tool registration, tool execution with mocked SDK)
- [ ] **TEST-19**: Integration tests for x402 on Base Sepolia testnet (real network, real payment)
- [ ] **TEST-20**: Integration tests for protocol detection on real x402 endpoints
- [ ] **TEST-21**: E2E test: full flow from `new BoltzPay()` → `agent.fetch(x402_url)` → data returned (testnet)
- [x] **TEST-22**: E2E test: MCP server start → tool call → response (with mocked payment)

### Monorepo Restructure

- [x] **MONO-01**: Archive SaaS code: remove packages/db, packages/ui, apps/web from workspace
- [x] **MONO-02**: Remove Supabase dependency from active packages
- [x] **MONO-03**: Clean core package: remove SaaS-specific types (WalletId, UserId, AgentId for DB-backed entities)
- [x] **MONO-04**: Keep reusable domain types: Money VO, DomainError, ProtocolAdapter interface, branded ID pattern
- [x] **MONO-05**: Adapt protocols: CdpManager accepts credentials directly, no CdpWalletStore/DB lookup
- [x] **MONO-06**: Upgrade dependencies: Vitest 4, Biome 2, pnpm 10, MCP SDK 1.26+, Astro 5.x
- [x] **MONO-07**: Add new packages: @boltzpay/cli, apps/landing (Astro)
- [x] **MONO-08**: Existing tests pass after restructure (adapted, not deleted)

## v2 Requirements

### Future Protocols

- **PROTO-V2-01**: AP2 (Google) adapter when spec stabilizes
- **PROTO-V2-02**: Visa TAP adapter when spec stabilizes
- **PROTO-V2-03**: Mastercard Agent Pay adapter when spec stabilizes
- **PROTO-V2-04**: UCP adapter when spec stabilizes
- **PROTO-V2-05**: Solana x402 support (SVM signing in addition to EVM)

### Future SDK

- **SDK-V2-01**: SDK Python native (no subprocess bridge)
- **SDK-V2-02**: SDK Go native
- **SDK-V2-03**: Persistent budget store (file-based or configurable)
- **SDK-V2-04**: Dashboard web for analytics/monitoring (Phase B)

### Future Distribution

- **DIST-V2-01**: n8n community node
- **DIST-V2-02**: awesome-boltzpay curated repo
- **DIST-V2-03**: Discord community (when > 500 stars)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Dashboard web | Not needed for OSS buzz, Phase B with traction |
| Wallet / funding system | User's own Coinbase/Stripe accounts |
| Stripe Treasury | US-only, requires C-Corp, legally complex |
| Authentication / OAuth | No backend, no user accounts |
| Database / Supabase persistence | SDK is local-only |
| Webhooks | No backend to receive them |
| Email alerts | No backend |
| Pricing tiers / subscriptions | SDK is free, open source, MIT |
| Admin panel | No SaaS |
| Monitoring / logging cloud | SDK has local logging only |
| Backend / hosted API service | Pure client-side SDK |
| Multi-currency (non-USD) | USDC + USD only for v1 |
| Plugin/extension API | Premature abstraction |
| Rate limiting | No server to rate limit |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MONO-01 | Phase 1 | Complete |
| MONO-02 | Phase 1 | Complete |
| MONO-03 | Phase 1 | Complete |
| MONO-04 | Phase 1 | Complete |
| MONO-05 | Phase 1 | Complete |
| MONO-06 | Phase 1 | Complete |
| MONO-07 | Phase 1 | Complete |
| MONO-08 | Phase 1 | Complete |
| PROTO-07 | Phase 1 | Complete |
| SDK-01 | Phase 2 | Complete |
| SDK-02 | Phase 2 | Complete |
| SDK-03 | Phase 2 | Complete |
| SDK-04 | Phase 2 | Complete |
| SDK-05 | Phase 2 | Complete |
| SDK-06 | Phase 2 | Complete |
| SDK-07 | Phase 2 | Complete |
| SDK-08 | Phase 2 | Complete |
| SDK-09 | Phase 2 | Complete |
| SDK-10 | Phase 2 | Complete |
| SDK-11 | Phase 2 | Complete |
| SDK-12 | Phase 2 | Complete |
| SDK-13 | Phase 2 | Complete |
| SDK-14 | Phase 2 | Complete |
| SDK-15 | Phase 2 | Complete |
| SDK-16 | Phase 2 | Complete |
| SDK-17 | Phase 2 | Complete |
| SDK-18 | Phase 2 | Complete |
| ERR-01 | Phase 2 | Complete |
| ERR-02 | Phase 2 | Complete |
| ERR-03 | Phase 2 | Complete |
| ERR-04 | Phase 2 | Complete |
| ERR-05 | Phase 2 | Complete |
| ERR-06 | Phase 2 | Complete |
| PROTO-01 | Phase 2 | Complete |
| PROTO-02 | Phase 2 | Complete |
| PROTO-03 | Phase 2 | Complete |
| PROTO-04 | Phase 2 | Complete |
| PROTO-05 | Phase 2 | Complete |
| PROTO-06 | Phase 2 | Complete |
| TEST-01 | Phase 2 | Pending |
| TEST-02 | Phase 2 | Pending |
| TEST-03 | Phase 2 | Complete |
| TEST-04 | Phase 2 | Complete |
| TEST-05 | Phase 2 | Complete |
| TEST-06 | Phase 2 | Complete |
| TEST-07 | Phase 2 | Complete |
| TEST-08 | Phase 2 | Pending |
| TEST-09 | Phase 2 | Complete |
| TEST-10 | Phase 2 | Complete |
| TEST-11 | Phase 2 | Pending |
| TEST-12 | Phase 2 | Pending |
| TEST-13 | Phase 2 | Complete |
| TEST-15 | Phase 2 | Complete |
| TEST-16 | Phase 2 | Complete |
| TEST-17 | Phase 2 | Complete |
| TEST-19 | Phase 2 | Pending |
| TEST-20 | Phase 2 | Pending |
| TEST-21 | Phase 2 | Pending |
| MCP-01 | Phase 3 | Complete |
| MCP-02 | Phase 3 | Complete |
| MCP-03 | Phase 3 | Complete |
| MCP-04 | Phase 3 | Complete |
| MCP-05 | Phase 3 | Complete |
| MCP-06 | Phase 3 | Complete |
| MCP-07 | Phase 3 | Complete |
| MCP-08 | Phase 3 | Complete |
| CLI-01 | Phase 3 | Complete |
| CLI-02 | Phase 3 | Complete |
| CLI-03 | Phase 3 | Complete |
| CLI-04 | Phase 3 | Complete |
| CLI-05 | Phase 3 | Complete |
| CLI-06 | Phase 3 | Complete |
| CLI-07 | Phase 3 | Complete |
| TEST-14 | Phase 3 | Complete |
| TEST-18 | Phase 3 | Complete |
| TEST-22 | Phase 3 | Complete |
| BUILD-01 | Phase 4 | Complete |
| BUILD-02 | Phase 4 | Complete |
| BUILD-03 | Phase 4 | Complete |
| BUILD-04 | Phase 4 | Complete |
| BUILD-05 | Phase 4 | Complete |
| BUILD-06 | Phase 4 | Complete |
| BUILD-07 | Phase 4 | Complete |
| BUILD-08 | Phase 4 | Complete |
| BUILD-09 | Phase 4 | Complete |
| DX-01 | Phase 5 | Complete |
| DX-02 | Phase 5 | Complete |
| DX-03 | Phase 5 | Complete |
| DX-04 | Phase 5 | Complete |
| DX-05 | Phase 5 | Complete |
| DX-06 | Phase 5 | Complete |
| LAND-01 | Phase 5 | Complete |
| LAND-02 | Phase 5 | Complete |
| LAND-03 | Phase 5 | Complete |
| LAND-04 | Phase 5 | Complete |
| LAND-05 | Phase 5 | Complete |
| LAND-06 | Phase 5 | Complete |
| LAND-07 | Phase 5 | Complete |
| LAND-08 | Phase 5 | Complete |
| INT-01 | Phase 6 | Complete |
| INT-02 | Phase 6 | Complete |
| INT-03 | Phase 6 | Complete |
| INT-04 | Phase 6 | Complete |
| LAUNCH-01 | Phase 7 | Pending |
| LAUNCH-02 | Phase 7 | Complete |
| LAUNCH-03 | Phase 7 | Complete |
| LAUNCH-04 | Phase 7 | Complete |
| LAUNCH-05 | Phase 7 | Complete |
| LAUNCH-06 | Phase 7 | Complete |
| LAUNCH-07 | Phase 7 | Complete |
| LAUNCH-08 | Phase 7 | Pending |
| LAUNCH-09 | Phase 7 | Complete |
| LAUNCH-10 | Phase 7 | Complete |
| LAUNCH-11 | Phase 7 | Complete |
| LAUNCH-12 | Phase 7 | Pending |
| LAUNCH-13 | Phase 7 | Complete |
| LAUNCH-14 | Phase 7 | Complete |
| LAUNCH-15 | Phase 7 | Pending |
| LAUNCH-16 | Phase 7 | Pending |
| LAUNCH-17 | Phase 7 | Pending |
| LAUNCH-18 | Phase 7 | Pending |
| LAUNCH-19 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 122 total
- Mapped to phases: 122
- Unmapped: 0

---
*Requirements defined: 2026-02-17*
*Last updated: 2026-02-17 after roadmap creation*
