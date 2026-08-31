import { execa } from 'execa';
import { resolveCodexModelId } from './model-registry.js';

export type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';

export interface RunHeadlessOptions {
  prompt: string;
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

interface CodexJsonlEvent {
  type: string;
  thread_id?: string;
  item?: { type?: string; text?: string };
}

/**
 * The CLI rejected the run before any turn started — no `thread.started` event ever appeared
 * in the JSONL stream, so nothing was billed or executed. Unambiguously safe to retry unmodified.
 */
export class CodexApiRejectionError extends Error {
  readonly exitCode: number | null;

  constructor(exitCode: number | null, detail: string) {
    super(
      `Codex CLI rejected the request before any turn started (exit code ${exitCode ?? '?'}): ${detail}`,
    );
    this.name = 'CodexApiRejectionError';
    this.exitCode = exitCode;
  }
}

/**
 * A turn started (billed work happened) but never reached `turn.completed` — e.g. the
 * connection dropped mid-stream. None of that partial work was ever reported back to the
 * caller, so it's still safe to retry from scratch.
 */
export class CodexStreamAbortedError extends Error {
  constructor(detail: string) {
    super(`Codex CLI aborted mid-turn: ${detail}`);
    this.name = 'CodexStreamAbortedError';
  }
}

/**
 * Catch-all for any other non-zero exit from the CLI. Deliberately built from just the exit
 * signal, not execa's own `.message`/`.shortMessage` — those embed the full command line
 * (including the entire prompt argument), which must never be surfaced as-is.
 */
export class CodexCliExecutionError extends Error {
  constructor(detail: string) {
    super(`Codex CLI exited unexpectedly (${detail}).`);
    this.name = 'CodexCliExecutionError';
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

function parseJsonlEvents(stdout: unknown): CodexJsonlEvent[] {
  if (typeof stdout !== 'string') return [];
  const events: CodexJsonlEvent[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as CodexJsonlEvent);
    } catch {
      // Non-JSON line (e.g. stray CLI banner output) — ignore rather than fail the whole parse.
    }
  }
  return events;
}

function threadIdOf(events: CodexJsonlEvent[]): string | undefined {
  return events.find((event) => event.type === 'thread.started')?.thread_id;
}

function lastAgentMessageOf(events: CodexJsonlEvent[]): string | undefined {
  const messages = events.filter(
    (event) => event.type === 'item.completed' && event.item?.type === 'agent_message',
  );
  return messages.at(-1)?.item?.text;
}

function toApiRejection(
  events: CodexJsonlEvent[],
  error: ExecaLikeError,
): CodexApiRejectionError | null {
  if (threadIdOf(events) !== undefined) return null;
  return new CodexApiRejectionError(error.exitCode ?? null, error.signal ?? 'no turn ever started');
}

function toStreamAbort(events: CodexJsonlEvent[]): CodexStreamAbortedError | null {
  if (threadIdOf(events) === undefined) return null;
  if (events.some((event) => event.type === 'turn.completed')) return null;
  return new CodexStreamAbortedError(lastAgentMessageOf(events) ?? 'no completion event received');
}

function toGenericExecutionError(error: unknown): CodexCliExecutionError | null {
  if (!isExecaLikeError(error)) return null;
  const parts: string[] = [];
  if (typeof error.exitCode === 'number') parts.push(`exit code ${error.exitCode}`);
  if (typeof error.signal === 'string') parts.push(`signal ${error.signal}`);
  return new CodexCliExecutionError(
    parts.length > 0 ? parts.join(', ') : 'no exit code — the process may not have started',
  );
}

export async function runCodexHeadless(options: RunHeadlessOptions): Promise<RunHeadlessResult> {
  // Codex has no per-directory allowlist analogous to Claude's --add-dir: `--yolo` already
  // grants unrestricted filesystem access (danger-full-access, no sandbox), so additionalDirs
  // is always satisfied under 'bypassPermissions' — the only permission mode ARCH's agents
  // actually dispatch headless with. Any other combination has no CLI equivalent to honor it.
  if ((options.additionalDirs?.length ?? 0) > 0 && options.permissionMode !== 'bypassPermissions') {
    throw new Error(
      'runCodexHeadless: additionalDirs requires permissionMode "bypassPermissions" — the Codex CLI has no scoped directory-allowlist flag.',
    );
  }

  const args = [
    'exec',
    '--skip-git-repo-check',
    '--json',
    '--model',
    resolveCodexModelId(options.model),
    '--cd',
    options.cwd,
  ];

  switch (options.permissionMode) {
    case 'bypassPermissions':
      args.push('--yolo');
      break;
    case 'acceptEdits':
      args.push('--full-auto');
      break;
    case 'plan':
      args.push('--sandbox', 'read-only');
      break;
    case 'default':
    case undefined:
      break;
  }

  if (options.resumeSessionId) {
    args.push('resume', options.resumeSessionId, options.prompt);
  } else {
    args.push(options.prompt);
  }

  let stdout: string;
  try {
    ({ stdout } = await execa('codex', args, {
      cwd: options.cwd,
      cancelSignal: options.signal,
    }));
  } catch (error) {
    if (!isExecaLikeError(error)) throw error;
    const events = parseJsonlEvents(error.stdout);
    throw (
      toApiRejection(events, error) ??
      toStreamAbort(events) ??
      toGenericExecutionError(error) ??
      error
    );
  }

  const events = parseJsonlEvents(stdout);
  const sessionId = threadIdOf(events);
  if (!sessionId) {
    throw new CodexCliExecutionError(
      'the CLI exited successfully but never emitted thread.started',
    );
  }

  return {
    sessionId,
    output: lastAgentMessageOf(events) ?? '',
  };
}
