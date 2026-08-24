# ARCH

ARCH is a multi-agent orchestration framework that automates the software development cycle
starting from a natural-language user story or task. ARCH coordinates three tiers of
agents — **Architect**, **TL**, and **Worker** — that drive headless instances of the
[Claude Code](https://claude.com/claude-code) CLI (`claude -p`) to plan, implement, and review
work autonomously, directly on your own git repository.

It ships with a CLI (`archctl`) and a terminal UI (`arch-terminal`) for launching and supervising runs.

## How it works

Work is organized into **runs**. Each run moves through two phases:

1. **`definition`** — the Architect reads your prompt and the target repository, then produces a
   plan: a project brief (`project.md`) and a dependency graph (DAG) of tasks
   (`tasks-index.yaml`). You can approve the plan as-is, ask for changes (`refine`), or abort it.
2. **`implementation`** — ARCH figures out which tasks are ready (no pending dependencies)
   and runs them with bounded concurrency (`maxConcurrency`). Each task goes through its own
   cycle:

   ```
   Worker implements the task in an isolated git worktree/branch
     → TL runs the task's automated checks (build, tests, lint — whatever the task defines)
       → Architect reviews the resulting diff
         → approved  → merge into the base branch, commit, task done
         → rejected  → correction feedback sent back to the Worker, up to maxRetries
   ```

   If a task exhausts its retries it is marked `failed`, and every task that (transitively)
   depends on it is cascade-failed without ever being dispatched. A run can also be aborted at
   any point; in-flight agent calls are cancelled and their tasks are marked `failed`.

All state for a run — the plan, per-agent Claude session ids (so work can be resumed), and task
metadata — is persisted under `.arch/` inside the *target* repository, so a run can be inspected
or resumed at any time, even after the daemon restarts.

## Architecture

### Agent hierarchy

| Agent | Responsibility |
|---|---|
| **Architect** | Turns a prompt into a plan (`definition` phase) and, later, performs the semantic code review of each task's diff before it can be merged. Can also revise a plan on request (`refine`). |
| **Team Lead (TL)** | Coordinates a single task's execution: dispatches the Worker, then runs the task's automated checks against the Worker's changes and reports pass/fail back to the daemon. |
| **Worker** | Implements one task inside its own git worktree, on its own branch, with a resumable Claude session so correction feedback can be applied incrementally. |

Architect and Worker calls go through `runClaudeHeadless` (`@losina/claude-runtime`) — the single
integration point with the `claude` CLI, invoked with `--print`/headless flags and (when
available) `--resume` for the agent's existing session. Only one Architect review runs at a time
per run (protected by an in-process mutex), while multiple Workers can run concurrently, each in
its own worktree.

### Task lifecycle

```
pending → ready → in_progress → in_review → done
                       ↑             │
                       └─ needs_correction ─┘
                       (up to maxRetries, then → failed)

blocked → failed   (cascade: any dependency of a failed task)
```

### Monorepo layout

```
packages/
├── schemas/         # Shared Zod schemas: Task, RunPlan, RunMeta, CheckDefinition, RunSessions...
├── config/          # Loading/saving .agentmeshrc.json and resolving .arch/ paths
├── core/            # DAG helpers (topo-sort, ready-tasks), git (diff, worktrees), session/checkpoint state
├── claude-runtime/  # Headless invocation of the `claude` CLI (execa) + model alias registry
├── validator/       # Runs a task's automated checks and builds correction feedback from failures
├── architect/       # Architect agent: prompts, plan-project, review-task
├── tl/               # TL agent: prompts, dispatch-worker, process-worker-report
├── ipc/              # Message types exchanged between the daemon and its clients
├── daemon/           # Orchestrator: definition/implementation phases, cascade-fail, mutex, persistence
├── daemon-client/    # IPC client over the Unix socket + auto-start of the daemon (ensureDaemon)
├── cli/              # `archctl` — Commander-based CLI
├── tui/              # `arch-terminal` — Ink/React terminal UI
└── e2e/              # End-to-end tests: real daemon + real git worktrees, Claude CLI mocked
```

The daemon talks to the CLI and the TUI over a Unix domain socket (`.arch/daemon.sock`) using a
newline-delimited JSON protocol. Neither client starts the daemon manually — `ensureDaemon` spawns
it as a detached background process the first time it's needed for a given directory, and later
invocations reuse that same instance as long as the socket is alive.

## Requirements

- Node.js ≥ 20 (the version pinned in [`.nvmrc`](.nvmrc))
- [pnpm](https://pnpm.io/) 10.x (`corepack enable` is enough if you use Corepack)
- The [Claude Code](https://claude.com/claude-code) CLI installed and authenticated (`claude`
  available on your `PATH`) — this is the actual engine behind every agent

## Installation

There are two ways to install ARCH, depending on whether you just want to use it or you want to
work on it.

### Via npm

```bash
npm install -g @losina/cli @losina/tui
```

This installs the `archctl` and `arch-terminal` executables directly from the npm registry — no
cloning or building required. It only needs Node.js ≥ 20 on your `PATH` (see
[Requirements](#requirements) above). Upgrade with the same command, or
`npm update -g @losina/cli @losina/tui`.

### One-line install script

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Losina24/ARCH/main/scripts/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Losina24/ARCH/main/scripts/install.ps1 | iex
```

This clones ARCH into a dedicated directory (`~/.local/share/arch-cli`, or `%LOCALAPPDATA%\arch-cli`
on Windows — not the directory you'll run ARCH *against*), builds it, and links the `archctl` and
`arch-terminal` executables onto your `PATH`. It requires git and Node.js ≥ 20 already on your machine
(see [Requirements](#requirements) above); if pnpm isn't installed, the script enables it via
Corepack. Re-running the same command later pulls the latest version and rebuilds.

If linking fails with `ERR_PNPM_NO_GLOBAL_BIN_DIR`, that's pnpm's global bin directory being
configured for the first time — restart your shell (so the updated `PATH` takes effect) and re-run
the command above.

The scripts themselves live at [`scripts/install.sh`](scripts/install.sh) and
[`scripts/install.ps1`](scripts/install.ps1) — read them before piping them into your shell, as with
any installer.

### For developers — clone & build

```bash
git clone https://github.com/Losina24/ARCH.git
cd ARCH
pnpm install
pnpm build
```

This compiles all 13 packages of the monorepo (via Turborepo) and produces the `archctl` and
`arch-terminal` executables. To use them outside of this repository, link them globally:

```bash
pnpm link:global
```

`pnpm link` doesn't support `--filter` (which forces pnpm's recursive/workspace mode), so `pnpm
--filter @losina/cli link --global` is out. `pnpm --dir`/`-C` doesn't work either — inside a pnpm
workspace it still resolves the *workspace root* package instead of the one at that path, so it
ends up linking the private root package (which has no `bin` entries) instead of
`@losina/cli`/`@losina/tui`. `link:global` works around this by actually changing directory into each
package before linking it — see the `link:global` script in [`package.json`](package.json) if you
need to run the two steps separately.

If this fails with `ERR_PNPM_NO_GLOBAL_BIN_DIR`, pnpm's global bin directory hasn't been set up on
your machine yet. Run `pnpm setup` once, restart your shell (so the updated `PATH` takes effect),
and retry `pnpm link:global`.

If you already ran the old `pnpm --dir packages/cli link --global` form, it linked the wrong
package under the global name `arch` — remove it with `rm ~/Library/pnpm/global/5/node_modules/arch`
(path may differ by platform/pnpm version; run `pnpm ls -g` to locate it) before linking again.

## Getting started

Run either tool from inside the repository you want ARCH to work on (the *target* repository —
this is separate from the ARCH monorepo itself).

### TUI

```bash
arch-terminal
```

Opens an interactive view of the current directory: the list of runs, a live detail view with the
task DAG, and actions to approve or refine a plan without leaving the terminal.

### CLI (`archctl`)

Every command accepts `--cwd <dir>` (defaults to the current directory) to target a specific
repository.

```bash
# Start a new run from a prompt
archctl run "Add a DELETE /users/:id endpoint that removes the user and their active sessions"

# List runs, or inspect one in detail
archctl list
archctl show <runId>

# See the plan (project.md + tasks) produced by the Architect
archctl plan <runId>

# Ask the Architect to revise the plan before approving it
archctl refine <runId> "Split task 2 into separate authentication and cascading-deletion tasks"

# Approve the plan and start the implementation phase
archctl approve <runId>

# Abort a run in progress
archctl abort <runId>

# Check whether the daemon is up for this directory
archctl daemon-status

# Configuration (per-agent models, concurrency, retries)
archctl config get
archctl config set --architect-model claude-opus-5 --tl-model claude-sonnet-5 \
  --worker-model claude-sonnet-5 --max-concurrency 4 --max-retries 3
```

### Project configuration

Configuration is stored in `.agentmeshrc.json` at the root of the *target* repository. When it's
missing, these defaults apply (see [`.agentmeshrc.example.json`](.agentmeshrc.example.json)):

```json
{
  "models": {
    "architectModel": "claude-opus-5",
    "tlModel": "claude-sonnet-5",
    "workerModel": "claude-sonnet-5"
  },
  "execution": {
    "maxConcurrency": 4,
    "maxRetries": 3
  }
}
```

### On-disk state (`.arch/`)

`.arch/` is created inside the *target* repository (not the ARCH monorepo) and should never be
committed — it's already listed in `.gitignore`:

```
.arch/
├── daemon.sock       # Unix socket the daemon listens on
├── daemon.log        # stdout/stderr of the detached daemon process
└── runs/<runId>/
    ├── meta.json       # RunMeta (phase, timestamps...)
    ├── project.md      # Architect's project brief
    ├── tasks-index.yaml
    ├── tasks/*.md
    ├── worktrees/      # one git worktree per in-flight task
    └── sessions.json   # per-agent Claude session ids, used to resume conversations
```

## Development

```bash
pnpm build       # turbo run build across all packages
pnpm test        # turbo run test (Vitest) across all packages
pnpm typecheck   # turbo run typecheck
pnpm lint        # biome check .
pnpm lint:fix    # biome check --write .
```

Turborepo builds each package's workspace dependencies first (`build`/`typecheck`/`test` all
depend on `^build`), so `pnpm build` alone is enough to get everything compiled and ready for the
other commands.

To iterate on a single package:

```bash
pnpm --filter @losina/daemon dev    # tsc --watch
pnpm --filter @losina/daemon test
```

### Testing strategy

- **Unit tests** live next to the code they cover (`src/**/*.test.ts`) in every package and run
  with Vitest.
- **End-to-end tests** (`packages/e2e`) start a real daemon in-process, talk to it over a real
  Unix socket, and operate on a real temporary git repository — including real worktrees, commits,
  and merges. The only thing they mock is the boundary with the `claude` CLI
  (`@losina/claude-runtime`), so the full orchestration logic (task graph, retries, cascade-fail,
  abort) is exercised for real without depending on live model calls.

## License

[MIT](LICENSE)