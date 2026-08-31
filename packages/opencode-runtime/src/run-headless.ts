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
  /** Extra directories the session may read/write outside `cwd`. See the guard below. */
  additionalDirs?: string[];
}

export interface RunHeadlessResult {
  sessionId: string;
  output: string;
}

interface OpencodeJsonlEvent {
  type: string;
  sessionID?: string;
  part?: { type?: string; text?: string; reason?: string };
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

function isExecaLikeError(error: unknown): error is ExecaLikeError {
  return typeof error === 'object' && error !== null && 'stdout' in error;
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

function sessionIdOf(events: OpencodeJsonlEvent[]): string | undefined {
  return events.find((event) => typeof event.sessionID === 'string')?.sessionID;
}

function lastTextOf(events: OpencodeJsonlEvent[]): string | undefined {
  const textEvents = events.filter((event) => event.type === 'text' && event.part?.type === 'text');
  return textEvents.at(-1)?.part?.text;
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

  args.push(options.prompt);

  let stdout: string;
  try {
    ({ stdout } = await execa('opencode', args, {
      cwd: options.cwd,
      cancelSignal: options.signal,
    }));
  } catch (error) {
    if (!isExecaLikeError(error)) throw error;
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
  };
}
