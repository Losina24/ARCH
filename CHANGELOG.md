# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- The run detail view now has exactly one place to talk to a run: the Architect. The Console and Monitor's task detail page are read-only (you can watch any agent's transcript, but there's no box to message it directly anymore), and when a task exhausts its retries or crashes into `awaiting_human`/`failed`, the Architect's consultation question (see below) now surfaces right there as the same conversation, auto-switching you to it — answer freely, press Enter to accept its recommendation, or `/skip`. Your reply is forwarded to the Worker verbatim through the existing `retryTask`, with no second Architect call in between. `arch retry-task` still works from the CLI unchanged, as a scripting escape hatch.

### Added
- When a task exhausts its retries or crashes into `awaiting_human`/`failed`, the Architect is now consulted before the human is: it's shown the task brief, prior corrections, the worker's diff, and exactly why the deterministic rules gave up, and gets one chance to turn that into a short, human-facing question with a concrete recommended answer. This is best-effort and purely additive — a consultation can never change the task's own outcome (it's queued and resolved after the task is already finalized), and if it fails or times out the task still fails/pauses exactly as before, just without a question attached. The question now shows up right in the run detail view (see above); it's also still posted as an `agent:message` on the Architect's transcript.
- The home screen's slash-command suggestions are now navigable: `↑`/`↓` move a highlight through the matching commands, `Tab` fills the input with the highlighted one without running it, and `Enter` runs the highlighted command even when the typed text is only a prefix (e.g. `/se` + Enter opens Settings) instead of reporting an unknown command. The run detail view's Architect conversation box gets the same treatment for its own commands (`/approve`, `/abort`, `/skip`).

### Fixed
- The run detail view's footer (command hints, status messages, and the feedback/grilling/agent-prompt inputs) no longer flickers at the bottom of the screen. Its height was a fixed row-count estimate per section, correct only while every section stayed one line tall; once typed or pasted text wrapped onto a second line, or a hint/status line wrapped by width, the real output grew taller than reserved, reached the terminal's full height, and tripped Ink 5's whole-screen clear-and-redraw on every keystroke — the same failure mode the one-row render headroom added in 0.2.0 already works around for animation frames. The footer's height is now measured for real (mirroring how `ScrollBox` already measures body content) instead of assumed.
- Slash commands now tolerate a stray space right after the `/` (`/ quit` behaves exactly like `/quit`) and are matched case-insensitively everywhere they're recognized — the live suggestions dropdown, the home screen's command parser, and the `/approve`/`/abort`/`/skip`/`/done` checks in the run detail view, which previously compared the typed text against a literal string and so silently treated a mistyped command as free-form text sent to the Architect.
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
