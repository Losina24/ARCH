# Contributing to ARCH

Thanks for your interest in improving ARCH! This document covers how to get a working setup,
what to check before opening a pull request, and how to report bugs or propose features.

## Getting set up

Requirements (see [`README.md`](README.md#requirements) for details):

- Node.js ≥ 20 (pinned in [`.nvmrc`](.nvmrc))
- pnpm 10.x (`corepack enable` if you use Corepack)
- The [Claude Code](https://claude.com/claude-code) CLI installed and authenticated, if you plan
  to exercise ARCH end-to-end rather than just running its test suite

```bash
git clone https://github.com/Losina24/ARCH.git
cd ARCH
pnpm install
pnpm build
```

## Making a change

1. Fork the repository and create a branch off `main`.
2. Make your change. Unit tests live next to the code they cover (`src/**/*.test.ts`); add or
   update them alongside any behavior change.
3. Before opening a pull request, run the full check suite from the repo root:

   ```bash
   pnpm build
   pnpm typecheck
   pnpm test
   pnpm lint
   ```

   `pnpm lint:fix` will auto-fix most formatting/linting issues (Biome).
4. Open a pull request describing what changed and why. Reference any related issue.

If your change touches orchestration behavior (the daemon, task lifecycle, agent dispatch), please
add or update a test in `packages/e2e` — see [`README.md`](README.md#testing-strategy) for how
those tests mock the boundary with the `claude` CLI while exercising the rest of the system for
real.

## Reporting bugs / proposing features

Open a [GitHub issue](https://github.com/Losina24/ARCH/issues) with:

- What you expected to happen vs. what happened
- Steps to reproduce (including your `.agentmeshrc.json`, if relevant)
- Any relevant output from `.arch/daemon.log` in the target repository

For feature proposals, a short description of the use case is more useful upfront than a full
design — happy to discuss the approach in the issue before any code is written.
