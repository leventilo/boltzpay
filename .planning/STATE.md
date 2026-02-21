# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-17)

**Core value:** `agent.fetch(url)` — your AI agent pays automatically, whatever the protocol.
**Current focus:** Phase 7: Launch

## Current Position

Phase: 7 of 7 (Launch)
Plan: 6 of 6 in current phase
Status: Executing Phase 7
Last activity: 2026-02-21 — Completed 07-03 (Per-Package READMEs & Framework Integrations)

Progress: [████████████████░░░░] 83% (Phase 7 Plan 5/6)

## Performance Metrics

**Velocity:**
- Total plans completed: 34
- Average duration: 4 min
- Total execution time: 1.73 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-cleanup | 5 | 13 min | 3 min |
| 02-sdk-core | 7 | 21 min | 3 min |
| 03-mcp-server-cli | 4 | 22 min | 6 min |
| 04-build-pipeline-ci | 4/4 | 9 min | 2 min |

| 04.1-multi-chain-hardening | 7/7 | 52 min | 7 min |

**Recent Trend:**
- Last 5 plans: 04.1-02 (9min), 04.1-03 (7min), 04.1-05 (10min), 04.1-06 (10min), 04.1-07 (6min)
- Trend: Consistent, final verification plan faster due to established test patterns

*Updated after each plan completion*
| Phase 04.1 P01 | 6min | 2 tasks | 10 files |
| Phase 04.1 P02 | 9min | 2 tasks | 9 files |
| Phase 04.1 P04 | 4min | 2 tasks | 6 files |
| Phase 04.1 P03 | 7min | 2 tasks | 7 files |
| Phase 04.1 P05 | 10min | 2 tasks | 16 files |
| Phase 04.1 P06 | 10min | 2 tasks | 25 files |
| Phase 04.1 P07 | 6min | 2 tasks | 16 files |
| Phase 05 P01 | 2min | 2 tasks | 13 files |
| Phase 05 P02 | 2min | 1 tasks | 1 files |
| Phase 05 P03 | 2min | 2 tasks | 5 files |
| Phase 05 P04 | 3min | 2 tasks | 10 files |
| Phase 05 P05 | 3min | 2 tasks | 5 files |
| Phase 06 P05 | 3min | 2 tasks | 5 files |
| Phase 06 P02 | 4min | 2 tasks | 10 files |
| Phase 06 P03 | 4min | 2 tasks | 11 files |
| Phase 06 P01 | 5min | 2 tasks | 14 files |
| Phase 06 P04 | 6min | 3 tasks | 9 files |
| Phase 07 P01 | 2min | 2 tasks | 3 files |
| Phase 07 P02 | 2min | 2 tasks | 3 files |
| Phase 07 P03 | 2min | 2 tasks | 7 files |
| Phase 07 P04 | 2min | 2 tasks | 4 files |
| Phase 07 P03 | 2min | 2 tasks | 6 files |

## Accumulated Context

### Roadmap Evolution

- Phase 04.1 inserted after Phase 4: Multi-chain multi-protocol SDK hardening (URGENT)

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 7-phase structure derived from 12 requirement categories, depth standard
- [Roadmap]: Phase 5 (Docs) and Phase 6 (Integrations) can run in parallel after Phase 4
- [Roadmap]: ACP full implementation in Phase 2 (not deferred), per PROJECT.md decision
- [01-01]: Kept .next/ in .gitignore as safety net even though Next.js removed
- [01-01]: Preserved devDependencies as-is (version upgrades deferred to Plan 03)
- [01-02]: Kept Brand<K,T> generic only — SDK defines own branded IDs in Phase 2
- [01-02]: ProtocolAdapter.execute() takes request object without walletId/userId — signer injected at construction
- [01-03]: Used pnpm 10.11.0 stable; TypeScript resolved to 5.9.3 via ^5.8.3 range
- [01-03]: Biome v2 organizeImports migrated to assist.actions.source config automatically
- [01-04]: CdpManager uses single Mutex + cached account instead of per-wallet Map<Mutex>
- [01-04]: Client creation errors wrapped separately from account creation errors in CdpProvisioningError
- [01-05]: CLI package is ESM-only (no CJS) with shebang banner for bin entry
- [01-05]: Landing page uses Astro 5.x minimal template with static output
- [01-05]: SDK and MCP both set to type: module for ESM consistency
- [02-01]: Zod v4 (4.3.6) installed — import { z } from 'zod' works directly
- [02-01]: 3 required Coinbase credentials (apiKeyId, apiKeySecret, walletSecret) per CDP SDK v2 research
- [02-01]: Error code types are union literals scoped per error class for compile-time safety
- [02-03]: Lazy CdpClient creation via require() in factory — constructor stays synchronous
- [02-03]: AcpAdapter added conditionally only when stripeSecretKey is provided
- [02-03]: Uint8Array body cast to BodyInit for fetch passthrough DOM lib compatibility
- [02-04]: Stripe added as direct dependency of protocols package for AcpAdapter PaymentIntent creation
- [02-04]: ACP detection is best-effort via headers — spec has no standard discovery mechanism
- [02-04]: acpBaseUrl bypass skips detection and directly invokes AcpAdapter for known ACP endpoints
- [02-04]: Common payment flow extracted into private executePaymentFlow() method in BoltzPay
- [02-05]: Mocked @coinbase/cdp-sdk and @boltzpay/protocols via vi.mock for BoltzPay constructor tests
- [02-05]: Used budget:warning instead of error in removeAllListeners test (Node.js EventEmitter behavior)
- [02-06]: Mock Stripe via private field injection instead of vi.mock -- require() in ESM bypasses Vitest mock
- [02-06]: SDK functional tests mock @boltzpay/protocols with controllable mockProbe/mockExecute functions
- [02-06]: maxAmount=0 blocks all payments (Money.fromDollars("0.00"), any quote > 0 triggers per_transaction_exceeded)
- [02-07]: Integration/E2E tests use describe.runIf(env vars) — skip gracefully without credentials
- [02-07]: X402Adapter.detect() must use GET not HEAD — x402 middleware only intercepts GET
- [02-07]: BoltzPay rejects failed payments before recording spending (success check added)
- [02-07]: Local x402 test server uses mock facilitator (no ETH for gas needed)
- [02-07]: CDP getOrCreateAccount is deterministic per name across sessions (address stable)
- [02-07]: safeFetch MUST forward Request objects directly — extracting only URL strips payment headers
- [02-07]: wrapFetchWithPayment passes Request objects (not url+init) for signed retries
- [03-01]: Import CallToolResult from @modelcontextprotocol/sdk/types.js for registerTool callback type compatibility
- [03-01]: Use z.record(z.string(), z.string()) for zod v4 compat with MCP SDK zod-compat layer
- [03-01]: setup.ts created as stub (full implementation in Plan 03)
- [03-01]: discover tool uses 6 static API entries (x402.org demos, Proxy402, Serper, NewsAPI)
- [03-02]: process.exit() instead of process.exitCode for clean async error handling with Commander
- [03-02]: parseAsync() in entry point to properly handle async command actions
- [03-02]: SDK package.json exports fixed (index.mjs -> index.js for type:module)
- [03-03]: Use Client+InMemoryTransport for tool testing instead of extracting handler functions
- [03-03]: Import Money from @boltzpay/sdk re-export (not @boltzpay/core) since MCP only depends on SDK
- [03-03]: Export getConfigPath, readExistingConfig, buildServerEntry from setup.ts for testability
- [03-03]: Vitest 4 test options as 2nd argument (timeout: 15000) not 3rd position object
- [03-04]: Import Money from @boltzpay/sdk (not @boltzpay/core) since CLI has no direct core dependency
- [03-04]: Mock process.exit() instead of refactoring handleCliError -- preserves production behavior
- [03-04]: Test commands via Commander parseAsync with mocked createSdkFromEnv for full integration
- [04-01]: Split types conditions (import.types + require.types) instead of flat top-level types field
- [04-01]: Node >=18.0.0 minimum across all packages and root (down from >=20.0.0)
- [04-02]: Fixed versioning glob @boltzpay/* for lockstep across all 5 packages
- [04-02]: Public access for scoped packages, commit: false (CI handles commits)
- [04-02]: @changesets/changelog-github with boltzpay/boltzpay repo reference (placeholder for Phase 7)
- [04-03]: ESM-only packages (mcp, cli) skip attw -- CJS resolution warnings expected and acceptable for executables
- [04-03]: 500KB per-package size limit enforced via npm pack + statSync
- [04-04]: No OS matrix in CI -- pure JS SDK, Ubuntu-only sufficient
- [04-04]: Build runs first in CI since lint/typecheck/test depend on build outputs
- [04-04]: check:size runs as root pnpm script (not turbo task) since it packs all 5 packages
- [04-04]: Release uses Node 22 only, concurrency key prevents parallel release runs
- [04.1-01]: Open string union (KnownProtocolType | string & {}) for extensible ProtocolType with IDE autocomplete
- [04.1-01]: SDK PaymentRecord/PaymentDetails/BoltzPayResponse updated to use ProtocolType instead of hardcoded union
- [04.1-01]: allAccepts on ProtocolQuote is optional to preserve backward compat
- [04.1-02]: CdpSvmSigner implements TransactionPartialSigner (simplest TransactionSigner variant, returns SignatureDictionary)
- [04.1-02]: @solana/kit installed explicitly — pnpm strict mode requires explicit dependency for imports
- [04.1-02]: WalletBalances.balanceUsdcCents undefined for both chains in v0.1 (graceful degradation)
- [04.1-04]: AcpAdapter.detect() tries manifest.json first, HEAD headers as fallback -- additive, no breaking change
- [04.1-04]: Manifest valid if JSON object contains version, namespace, or namespaces field
- [04.1-04]: probeAll() uses Promise.allSettled for both detection and quoting -- no single adapter failure blocks others
- [Phase 04.1]: Register-all-available-schemes: always register EVM, optionally SVM. x402 client routes internally
- [Phase 04.1]: allAccepts undefined (not empty) for V1 non-CAIP networks — signals no multi-chain data available
- [Phase 04.1]: SDK migrated from CdpManager to CdpWalletManager early (Rule 3 fix) — Plan 05 can skip this
- [04.1-05]: fetch() uses probeAll instead of probe — enables multi-adapter fallback at SDK level
- [04.1-05]: Chain selection gated on allAccepts presence — V1 endpoints skip selectBestAccept entirely
- [04.1-05]: BudgetExceededError bypasses fallback loop — budget constraints are user-level, not protocol-level
- [04.1-05]: PaymentRecord/PaymentDetails protocol widened to string for extensibility
- [04.1-06]: networkToShortName maps CAIP-2 prefixes to short display names: eip155:* -> Base, solana:* -> Solana
- [04.1-06]: getBalances failure caught silently (graceful degradation) — wallet display continues without balance info
- [04.1-06]: allAccepts length > 1 triggers Options/Alternatives display; single option uses simple backward-compat format
- [04.1-06]: Chain override validates against fixed set ('evm', 'svm') before passing to SDK
- [04.1-07]: Non-null assertions (!) replaced with explicit guards across all packages for Biome zero-warning compliance
- [04.1-07]: Pre-existing lint issues from parallel Plans 05/06 fixed as Rule 3 blocking pipeline verification
- [05-01]: Copyright holder set to 'BoltzPay Contributors' (standard for MIT open source)
- [05-01]: Repository URL set to leventilo/boltzpay-ci-test (updated to boltzpay/boltzpay at Phase 7 launch)
- [05-02]: Added Install section with npm command before quickstart for clarity
- [05-02]: Added Packages table listing all 5 npm packages for discoverability
- [05-02]: Used invy.bot/api as primary example URL throughout (verified live endpoint)
- [05-03]: Used toDisplayString() instead of non-existent toDollars() — Money VO returns $X.XX format
- [05-03]: Budget state accessed via budget.dailyRemaining (flat property, not nested budget.daily.remaining)
- [05-04]: Tailwind v4 via @tailwindcss/vite plugin (not @astrojs/tailwind) -- CSS-first, no tailwind.config.js
- [05-04]: Geist fonts via @fontsource packages (not Google Fonts CDN) -- self-hosted, no external requests
- [05-04]: Pure Astro components (no React/Vue) -- static site, no JS framework needed
- [05-04]: HTML entities for feature icons (not icon library) -- zero dependency, fast
- [05-05]: Footer keeps 3 links only (GitHub, npm, MIT) -- open source project footer, not SaaS
- [05-05]: llms-full.txt condensed to 243 lines with complete API surface, MCP tools, CLI commands, directory, and 3 examples
- [06-05]: 26 static directory entries (within 25-30 target) across 7 categories: crypto-data, ai-llm, web-scraping, defi, utilities, media, demo
- [06-05]: Bazaar items mapped with category "bazaar" to distinguish from curated static entries
- [06-05]: USDC pricing: 4 decimals for sub-cent, 2 decimals otherwise for readability
- [06-05]: Chain derivation: "solana" keyword in network maps to "Solana", everything else to "Base"
- [Phase 06-02]: PEP 639: Removed License classifier, kept license = MIT in pyproject.toml (modern setuptools requires license expressions)
- [Phase 06-02]: CLI bridge uses npx -y @boltzpay/cli for zero-install experience (auto-downloads CLI on first call)
- [06-03]: CrewAI errors returned as strings (not raised) following CrewAI BaseTool pattern for agent recovery
- [06-03]: Same CLI bridge pattern as LangChain but independent copy (no cross-dependency between Python packages)
- [06-03]: OpenClaw metadata field uses single-line JSON string for parser compatibility
- [06-01]: AI SDK v6 tool() returns { description, inputSchema, execute } -- not v5 'parameters'
- [06-01]: discover tool is SDK-independent (uses static API_DIRECTORY import, no BoltzPay instance needed)
- [06-01]: ai and zod as peerDependencies (not bundled) to avoid version conflicts
- [Phase 06-04]: NodeConnectionTypes.Main (plural) for n8n node IO — n8n-workflow exports enum as NodeConnectionTypes
- [Phase 06-04]: SDK dep via file:../../packages/sdk for local dev, switch to ^0.1.0 on npm publish
- [Phase 06-04]: AcceptOption.amount (bigint) converted to Number() for n8n IDataObject JSON serialization
- [07-01]: npm @boltzpay scope must be created by David before publish (scope not found on registry)
- [07-01]: Only n8n added to pnpm workspace (Python packages use their own publish mechanisms)
- [07-02]: Trusted Publishers OIDC instead of PYPI_TOKEN secret — more secure, no long-lived secret
- [07-02]: Python tests build Node packages first — integrations depend on CLI via npx
- [07-02]: Renovate over Dependabot — better monorepo grouping, single config for npm + PyPI
- [07-02]: Independent Python versioning — manual pyproject.toml bumps, PyPI rejects duplicates
- [07-04]: All social content in .archive/launch-content/ (gitignored) — never committed to public repo
- [07-04]: Show HN links to GitHub (not landing page) per HN best practices
- [07-04]: LangChain community uses Slack (not Discord) — post to #showcase or #integrations
- [Phase 07]: [07-03]: Install commands placed before code snippets in Framework Integrations for standard discovery pattern

### Pending Todos

- ~~[CLI]: Fix `wallet` command lazy provisioning UX~~ — RÉSOLU (wallet affiche adresse + solde sans paiement)
- [Post-Phase A]: Add API directory health verifier — CLI command + dashboard monitoring for stale/dead directory entries
- [Phase 6.1]: `boltzpay init` — interactive CLI wizard (setup .env, validate keys, test connection, demo check). Style Supabase/n8n onboarding.
- [Phase 7]: Mintlify docs deploy — site prêt, juste publier (docs.boltzpay.ai)
- [Phase 7]: Personal GitHub profile — minimaliste, guidé par Claude
- [Phase 7]: Per-package README for npm pages
- [Phase 7]: Update all GitHub URLs → leventilo/boltzpay
- [Phase 7]: CI/CD complet (PyPI publish, Python tests, branch protection, Dependabot)
- [Décision]: Pas d'org GitHub pour l'instant — leventilo/boltzpay, org quand traction

### Blockers/Concerns

- [Research]: MCP SDK v2 may ship during dev — monitor, stay on v1.x for now
- [07-01]: BLOCKER — @boltzpay npm scope does not exist. David must create it at npmjs.com/org/create before publish

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed 07-03-PLAN.md
Resume file: .planning/phases/07-launch/07-03-SUMMARY.md
