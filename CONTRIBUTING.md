# Contributing to BoltzPay

Thank you for your interest in contributing to BoltzPay! This guide will help you get started.

## Prerequisites

- **Node.js** >= 20
- **pnpm** 10

## Setup

```bash
git clone https://github.com/leventilo/boltzpay.git
cd boltzpay
pnpm install
pnpm build
pnpm test
```

## Project Structure

| Package | Description |
|---------|-------------|
| `packages/core` | Domain types and value objects (zero dependencies) |
| `packages/protocols` | Protocol adapters for x402 and L402 |
| `packages/sdk` | Composition root — the `BoltzPay` class and `agent.fetch()` |
| `packages/mcp` | MCP server for Claude Desktop (7 tools) |
| `packages/cli` | CLI for terminal usage and Python bridge |
| `apps/landing` | Astro static landing page |

## Development Commands

```bash
pnpm dev          # Watch mode (all packages)
pnpm build        # Build all packages
pnpm test         # Run tests (Vitest)
pnpm lint         # Lint and format (Biome)
pnpm typecheck    # Type check (TypeScript)
```

## Submitting a Pull Request

1. **Fork** the repository and clone your fork.
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. **Write tests** for any new functionality.
4. **Ensure CI passes** locally:
   ```bash
   pnpm build && pnpm lint && pnpm typecheck && pnpm test
   ```
5. **Push** your branch and open a Pull Request.
6. **Describe your changes** clearly in the PR description.

## Coding Standards

- **TypeScript strict mode** — no `any`, no implicit returns.
- **Biome** for formatting and linting — run `pnpm lint` before committing.
- **ESM-first** — all packages use `"type": "module"`.
- **Domain-Driven Design** — core domain has zero external dependencies.

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Usage |
|--------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `chore` | Tooling, config, dependencies |

Example: `feat(sdk): add retry logic to fetch()`

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
