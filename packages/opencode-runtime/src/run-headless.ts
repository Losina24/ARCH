import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execa } from 'execa';

export type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';

export interface RunHeadlessOptions {
  prompt: string;
  /** Canonical `provider/model` id, e.g. `github-copilot/gpt-4.1` — see `opencode models`. */
  model: string;
  cwd: string;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  signal?: AbortSignal;
  /** Receives each raw JSON event as soon as OpenCode writes its JSONL line. */
  onEvent?: (event: OpencodeJsonlEvent) => void;
  /** Extra directories the session may read/write outside `cwd`. See the guard below. */
  additionalDirs?: string[];
}

export interface RunHeadlessResult {
  sessionId: string;
  output: string;
  /** Cumulative input tokens across every event in the stream that reported usage, if any. */
  inputTokens?: number;
  /** Cumulative output tokens across every event in the stream that reported usage, if any. */
  outputTokens?: number;
}

export interface OpencodeToolState {
  status?: string;
  input?: unknown;
  error?: string;
}

export interface OpencodeJsonlEvent {
  type: string;
  sessionID?: string;
  part?: {
    type?: string;
    text?: string;
    reason?: string;
    tool?: string;
    state?: OpencodeToolState;
    usage?: { inputTokens?: number; outputTokens?: number };
  };
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: { name?: string; data?: { message?: string } };
}

/**
 * The CLI rejected the run before producing any assistant text — e.g. an unknown model id.
 * Unlike Claude/Codex, OpenCode reports this as a `type: "error"` event on a *successful*
 * (exit 0) process rather than a non-zero exit, so this is raised from the success path too.
 * Nothing was ever shown to the caller, so it's unambiguously safe to retry unmodified.
 */
export class OpencodeApiRejectionError extends Error {
  constructor(detail: string) {
    super(`OpenCode CLI rejected the request before producing a response: ${detail}`);
    this.name = 'OpencodeApiRejectionError';
  }
}

/**
 * A session started and produced at least some assistant text, but then an error event (or a
 * process crash) cut the run short before it could be reported back as a finished turn. None of
 * that partial work was ever returned to the caller, so it's still safe to retry from scratch.
 */
export class OpencodeStreamAbortedError extends Error {
  constructor(detail: string) {
    super(`OpenCode CLI aborted mid-turn: ${detail}`);
    this.name = 'OpencodeStreamAbortedError';
  }
}

/**
 * Catch-all for a genuine process crash (non-zero exit / signal) with no parseable event stream
 * at all. Deliberately built from just the exit signal, not execa's own `.message`/
 * `.shortMessage` — those embed the full command line (including the entire prompt argument),
 * which must never be surfaced as-is.
 */
export class OpencodeCliExecutionError extends Error {
  constructor(detail: string) {
    super(`OpenCode CLI exited unexpectedly (${detail}).`);
    this.name = 'OpencodeCliExecutionError';
  }
}

interface ExecaLikeError {
  stdout?: unknown;
  exitCode?: number;
  signal?: string;
}

// execa always attaches `stdout` to the error it throws for a failure that actually spawned a
// process, but a pre-spawn OS-level failure (e.g. ENAMETOOLONG, a prompt too large for the
// platform's command-line limit) never starts one and so has no `.stdout` at all — it does,
// however, always carry `command` (execa attaches that to every error it produces, spawned or
// not). Checking for `stdout` alone (as this used to) misses that case, letting execa's raw,
// unsanitized message — the entire escaped command line included — leak through unwrapped.
// Matching on either is what makes this catch both shapes. A plain, unrelated JS error thrown
// elsewhere has neither.
function isExecaLikeError(error: unknown): error is ExecaLikeError {
  return typeof error === 'object' && error !== null && ('stdout' in error || 'command' in error);
}

function parseJsonlEvents(stdout: unknown): OpencodeJsonlEvent[] {
  if (typeof stdout !== 'string') return [];
  const events: OpencodeJsonlEvent[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as OpencodeJsonlEvent);
    } catch {
      // Non-JSON line (e.g. stray CLI banner output) — ignore rather than fail the whole parse.
    }
  }
  return events;
}

interface JsonlReadable {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

function isJsonlReadable(value: unknown): value is JsonlReadable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { on?: unknown }).on === 'function'
  );
}

function notifyEvent(
  listener: ((event: OpencodeJsonlEvent) => void) | undefined,
  event: OpencodeJsonlEvent,
): void {
  if (!listener) return;
  try {
    listener(event);
  } catch {
    // Progress reporting is observational: a UI callback must never terminate the agent turn.
  }
}

function observeJsonlEvents(
  stdout: unknown,
  listener: ((event: OpencodeJsonlEvent) => void) | undefined,
): boolean {
  if (!listener || !isJsonlReadable(stdout)) return false;

  let pending = '';
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      notifyEvent(listener, JSON.parse(trimmed) as OpencodeJsonlEvent);
    } catch {
      // Ignore banners or other non-JSON noise without interrupting the CLI.
    }
  };

  stdout.on('data', (chunk) => {
    pending += String(chunk ?? '');
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
  });
  stdout.on('end', () => {
    consumeLine(pending);
    pending = '';
  });
  return true;
}

function replayEvents(
  stdout: unknown,
  listener: ((event: OpencodeJsonlEvent) => void) | undefined,
): void {
  for (const event of parseJsonlEvents(stdout)) notifyEvent(listener, event);
}

function sessionIdOf(events: OpencodeJsonlEvent[]): string | undefined {
  return events.find((event) => typeof event.sessionID === 'string')?.sessionID;
}

function lastTextOf(events: OpencodeJsonlEvent[]): string | undefined {
  const textEvents = events.filter((event) => event.type === 'text' && event.part?.type === 'text');
  return textEvents.at(-1)?.part?.text;
}

/** Accumulates token usage reported on `text`/`usage` events (`part.usage` or a top-level `usage`). */
function tokenUsageOf(events: OpencodeJsonlEvent[]): {
  inputTokens?: number;
  outputTokens?: number;
} {
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for (const event of events) {
    const usage = event.part?.usage ?? (event.type === 'usage' ? event.usage : undefined);
    if (!usage) continue;
    if (typeof usage.inputTokens === 'number') {
      inputTokens = (inputTokens ?? 0) + usage.inputTokens;
    }
    if (typeof usage.outputTokens === 'number') {
      outputTokens = (outputTokens ?? 0) + usage.outputTokens;
    }
  }
  return { inputTokens, outputTokens };
}

function errorEventOf(events: OpencodeJsonlEvent[]): OpencodeJsonlEvent | undefined {
  return events.find((event) => event.type === 'error');
}

function errorDetailOf(event: OpencodeJsonlEvent): string {
  return event.error?.data?.message ?? event.error?.name ?? 'unknown error';
}

/** Classifies an `error` event as a rejection (no text ever shown) or a mid-turn abort. */
function toRejectionOrAbort(
  events: OpencodeJsonlEvent[],
): OpencodeApiRejectionError | OpencodeStreamAbortedError | null {
  const errorEvent = errorEventOf(events);
  if (!errorEvent) return null;
  const detail = errorDetailOf(errorEvent);
  return lastTextOf(events) !== undefined
    ? new OpencodeStreamAbortedError(detail)
    : new OpencodeApiRejectionError(detail);
}

function toGenericExecutionError(error: unknown): OpencodeCliExecutionError | null {
  if (!isExecaLikeError(error)) return null;
  const parts: string[] = [];
  if (typeof error.exitCode === 'number') parts.push(`exit code ${error.exitCode}`);
  if (typeof error.signal === 'string') parts.push(`signal ${error.signal}`);
  return new OpencodeCliExecutionError(
    parts.length > 0 ? parts.join(', ') : 'no exit code — the process may not have started',
  );
}

// The OpenCode CLI has no stdin-prompt mode (unlike Claude/Codex, whose CLIs read the prompt
// from stdin when it's omitted from argv) — `opencode run`'s prompt is a positional argument
// only. A prompt anywhere close to Windows' ~32K-character command-line limit would make execa
// fail with ENAMETOOLONG before `opencode` even starts, the same incident this whole module's
// sibling runtimes were fixed for. There's no confirmed clean fix for OpenCode specifically (see
// the workaround below), so this threshold — comfortably under the OS limit, leaving room for
// the rest of argv — decides when to reach for it instead of accepting the risk silently.
const OVERSIZED_PROMPT_THRESHOLD = 8000;

/**
 * NEEDS EMPIRICAL VERIFICATION AGAINST A REAL `opencode` INSTALL: this assumes a `-f`-attached
 * file's content is read by the model as the effective prompt (the CLI docs describe `-f` only
 * as "file(s) to attach to message", not as a substitute for the positional prompt itself), and
 * the short instructional prompt's wording may need to change once tested live. This is the
 * best available mitigation given OpenCode has no documented stdin-prompt mode at all.
 */
async function writeOversizedPromptFile(prompt: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arch-opencode-prompt-'));
  const path = join(dir, 'prompt.md');
  await writeFile(path, prompt, 'utf-8');
  return path;
}

export async function runOpencodeHeadless(options: RunHeadlessOptions): Promise<RunHeadlessResult> {
  // OpenCode has no per-directory allowlist analogous to Claude's --add-dir: the `build` agent
  // (used for 'bypassPermissions', the only mode ARCH's agents actually dispatch headless with)
  // already grants unrestricted filesystem access, so additionalDirs is always satisfied there.
  // Any other combination has no CLI equivalent to honor it.
  if ((options.additionalDirs?.length ?? 0) > 0 && options.permissionMode !== 'bypassPermissions') {
    throw new Error(
      'runOpencodeHeadless: additionalDirs requires permissionMode "bypassPermissions" — the OpenCode CLI has no scoped directory-allowlist flag.',
    );
  }

  const args = ['run', '--format', 'json', '-m', options.model, '--dir', options.cwd];

  switch (options.permissionMode) {
    case 'plan':
      args.push('--agent', 'plan');
      break;
    case 'bypassPermissions':
    case 'acceptEdits':
    case 'default':
    case undefined:
      // The default ('build') agent already auto-allows every tool call — there's no distinct
      // opencode agent matching Claude's "ask per tool" default or "auto-accept edits only".
      break;
  }

  if (options.resumeSessionId) {
    args.push('-s', options.resumeSessionId);
  }

  let promptFilePath: string | undefined;
  if (options.prompt.length > OVERSIZED_PROMPT_THRESHOLD) {
    promptFilePath = await writeOversizedPromptFile(options.prompt);
    args.push('-f', promptFilePath, 'Read the attached file for your full task and instructions.');
  } else {
    args.push(options.prompt);
  }

  try {
    let stdout: string;
    let observingLiveStream = false;
    try {
      const subprocess = execa('opencode', args, {
        cwd: options.cwd,
        cancelSignal: options.signal,
      });
      observingLiveStream = observeJsonlEvents(
        (subprocess as unknown as { stdout?: unknown }).stdout,
        options.onEvent,
      );
      ({ stdout } = await subprocess);
      if (!observingLiveStream) replayEvents(stdout, options.onEvent);
    } catch (error) {
      if (!isExecaLikeError(error)) throw error;
      if (!observingLiveStream) replayEvents(error.stdout, options.onEvent);
      const events = parseJsonlEvents(error.stdout);
      throw (
        toRejectionOrAbort(events) ??
        (sessionIdOf(events) === undefined
          ? new OpencodeApiRejectionError(
              typeof error.exitCode === 'number'
                ? `exit code ${error.exitCode}`
                : 'no session ever started',
            )
          : null) ??
        toGenericExecutionError(error) ??
        error
      );
    }

    const events = parseJsonlEvents(stdout);
    const rejectionOrAbort = toRejectionOrAbort(events);
    if (rejectionOrAbort) throw rejectionOrAbort;

    const sessionId = sessionIdOf(events);
    if (!sessionId) {
      throw new OpencodeCliExecutionError(
        'the CLI exited successfully but produced no session events',
      );
    }

    return {
      sessionId,
      output: lastTextOf(events) ?? '',
      ...tokenUsageOf(events),
    };
  } finally {
    // Best-effort: a leaked temp dir on every oversized review — success or failure — would
    // quietly accumulate. Never let a cleanup failure mask the real result/error above.
    if (promptFilePath) {
      await rm(dirname(promptFilePath), { recursive: true, force: true }).catch(() => {});
    }
  }
}
