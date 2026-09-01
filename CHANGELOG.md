# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1]

### Added
- Multi-repo runs: `run.cwd` can now point to a plain folder containing several sibling git repositories instead of a single repo. The Architect discovers them, assigns each task an explicit `repoRoot`, and the orchestrator runs (and merges) each task's work in its own repository (`packages/core/src/git/repo-root.ts`, `packages/daemon/src/orchestrator/task-repo-root.ts`, `packages/architect`).
- `archctl` now resolves `--cwd` to its git repository root (or validates it as a multi-repo container) before dispatching any command, instead of silently threading a non-repo path through to the daemon.
- OpenCode Zen support in the TUI model picker, as its own provider entry with a curated model list, split out from the generic OpenCode provider.
- Token usage (`inputTokens`/`outputTokens`) is now reported by the OpenCode headless runtime when the underlying events carry it.

### Fixed
- The Agents panel in the Monitor view no longer shows a worker as "Working on TASK-XXX" after that task has failed — every failure path in the Team-Lead loop now emits the matching `agent:activity` event, not just the crash path.
- The TUI header no longer renders corrupted text at wide terminal widths. Root cause: a run's `title` was sliced from the raw prompt without normalizing whitespace, so embedded `\r`/`\n` characters could end up in the persisted title and get revealed once the header stopped truncating it.
- A run could get stuck forever in an unrecoverable state if a crashed task's own cleanup also threw (e.g. its worktree was no longer a valid git repository): the implementation loop now flips the run to `blocked` and releases its abort controller in that case, instead of leaving the daemon believing the loop was still alive.

### Removed
- Dropped the unused `packages/cloud-api` and `packages/cloud-runner` scaffolding, and the root `TO_DO.md`.
