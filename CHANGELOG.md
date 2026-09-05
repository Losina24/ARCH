# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Contract-first task sequencing: the Architect now explicitly identifies shared surface (types, interfaces, schemas, API/DTO shapes, DB migrations, config keys, event/protocol definitions) that several tasks would otherwise invent independently, gives it its own early no-dependency task, and makes every consumer `dependsOn` it — this guidance now also survives a `refine` round, which previously dropped all decomposition guidelines entirely. A dependent task's Worker prompt now names each dependency's id, title, and declared scope (falling back to a short excerpt when a dependency declared no scope) instead of being left to discover — or redefine — a contract blind, and the Architect's semantic review is now told which paths are owned by a task's dependencies so it can flag an out-of-scope edit as a defect. A dependency's committed-but-unmerged work (the case where the run's base branch is `develop`) is now merged into a dependent task's fresh worktree, so the contract is guaranteed to be physically present regardless of whether the base branch allowed the dependency to auto-merge.

### Fixed
- Slash commands now tolerate a stray space right after the `/` (`/ quit` behaves exactly like `/quit`) and are matched case-insensitively everywhere they're recognized — the live suggestions dropdown, the home screen's command parser, and the `/approve`/`/abort`/`/skip`/`/done` checks in the run detail view, which previously compared the typed text against a literal string and so silently treated a mistyped command as free-form text sent to the Architect.
- The run detail view's footer (command hints, status messages, and the feedback/grilling/agent-prompt inputs) no longer flickers at the bottom of the screen. Its height was a fixed row-count estimate per section, correct only while every section stayed one line tall; once typed or pasted text wrapped onto a second line, or a hint/status line wrapped by width, the real output grew taller than reserved, reached the terminal's full height, and tripped Ink 5's whole-screen clear-and-redraw on every keystroke — the same failure mode the one-row render headroom added in 0.2.0 already works around for animation frames. The footer's height is now measured for real (mirroring how `ScrollBox` already measures body content) instead of assumed.
- A task whose review prompt (brief + diff + corrections) ran past Windows' ~32K-character command-line limit used to crash the daemon outright: `runClaudeHeadless` passed the entire prompt as a CLI argument, so `execa`/`CreateProcess` refused to even spawn `claude` (`ENAMETOOLONG`), cascading into the task — and every task depending on it — being marked `failed` and the whole run `blocked`. The prompt now travels via stdin instead (mirroring `codex-runtime`'s existing approach), which has no such limit; `opencode-runtime` gets a best-effort `-f`/file-attachment fallback for the same class of failure, since its CLI has no stdin-prompt mode. Separately, a pre-spawn OS-level failure like this one used to bypass every runtime's own error sanitization (it has no `.stdout` for the `.stdout`-only check to catch), leaking the raw, unsanitized command line — prompt included — into `daemon.log`; sanitization now also matches on `command`, which every execa error carries regardless of whether the process ever started. And when the Architect's review crashes for any reason, the task's `failureReason` now carries the real underlying error instead of a generic "Architect review failed for task X" with no further detail.

### Removed
- The fictional "Team Lead" agent. There was never an LLM behind it: `role: 'tl'` activity events reflected the task orchestration loop's own scheduling state, not any agent's reasoning, and its configurable `tlModel` was never actually used to make a model call. The orchestration work it appeared to represent (worktree lifecycle, running automated checks, enforcing task scope, retry budgeting) is unchanged — only the fictional persona and its dead config knob are gone. Worker correction prompts now attribute automated-check and scope-violation feedback to "the automated checks" / "an automated scope check" instead of a nonexistent colleague; the Architect's existing per-task review remains the Worker's actual (and already context-isolated) evaluator.

## [0.2.1]

### Fixed
- ARCH now runs on native Windows. The daemon's IPC now uses a Windows named pipe instead of a real AF_UNIX socket, which could fail to bind with `EACCES` regardless of directory permissions; the CLI and the daemon it spawns now agree on the current repo's path (`git rev-parse --show-toplevel`'s forward-slash output is normalized to the native separator before being hashed into the daemon's socket/pipe name, and the spawned daemon is handed that resolved `cwd` explicitly instead of re-deriving its own); file paths surfaced in agent progress events are always forward-slash regardless of platform; and the `archctl`/`arch-terminal` build no longer shells out to `chmod`, which doesn't exist on Windows.

## [0.2.0]

### Added
- Live, provider-neutral agent progress for Claude Code, Codex, and OpenCode. Their JSONL streams are now observed while a turn is running, normalized into safe activity such as `Searching files`, `Running tests`, or `Editing files`, persisted on `agent:activity` events, and forwarded through Architect, Team-Lead, and Worker flows to the TUI.
- Runtime and end-to-end regression coverage for streamed progress, interrupted/timeout dispatch recovery, idempotent worktrees, daemon socket teardown, Console rendering, review logs, and concurrent Worker slot allocation.

### Changed
- The Console and agent panels now show sanitized live tool/file detail. Repetitive `Analyzing results` transitions are omitted from transcripts and consecutive identical activities are collapsed into a single `×N` entry.
- The active Console row keeps an animated fixed-width spinner, but uses a 400 ms cadence instead of 80 ms. The run detail view also reserves one terminal row so Ink does not clear the entire screen on every animation frame.
- Monitor and Console now keep their left-hand modules fixed while only the DAG or selected-agent transcript scrolls. Agent consoles open at the latest message and follow new output while the viewport remains at the bottom; scrolling up pauses that follow mode until the user returns to the tail. Compact task consoles also stay pinned to their newest activity.
- Codex production turns no longer inherit an unconditional 30-minute subprocess timeout; callers may still configure an explicit hard timeout. Planning and review views now surface the same live activity detail as Worker consoles.

### Fixed
- Codex timeouts and interrupted/rejected provider turns are treated as transient dispatch failures. The Team Lead retries them internally up to three times in the same task cycle and worktree, without consuming the Architect correction retry counter.
- Worktree creation is now idempotent across retries: ARCH reuses the expected registered worktree, reattaches an existing task branch when its old worktree is gone, and reports explicit conflicts for mismatched registrations or paths. This prevents retries from failing with `fatal: a branch named 'feat/TASK-XXX' already exists`.
- Frequent progress broadcasts no longer let disconnected sockets (`EPIPE`/`ECONNRESET`) crash the daemon, and explicit daemon shutdown no longer races with a late idle-shutdown timer scheduled by socket teardown.
- Monitor review logs now derive `Review started` exclusively from `review:requested`; provider `thinking`/`Analyzing results` events can no longer create several fake review starts for one review round.
- Repeated terminal transitions can no longer insert the same display slot into the free-Worker pool multiple times. Concurrent tasks therefore receive distinct Worker numbers, while a resumed failed/awaiting task reclaims its old slot or safely moves to another available slot.

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
