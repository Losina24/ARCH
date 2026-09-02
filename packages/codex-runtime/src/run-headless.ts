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
  /** Optional hard subprocess limit. Omitted in production so active long-running turns can finish. */
  timeoutMs?: number;
  /** Receives each documented `--json` event as soon as the CLI writes its JSONL line. */
  onEvent?: (event: CodexJsonlEvent) => void;
  /** Extra directories the session may read/write outside `cwd`. See the guard below. */
  additionalDirs?: string[];
}

export interface RunHeadlessResult {
  sessionId: string;
  output: string;
}

export interface CodexJsonlItem {
  type?: string;
  text?: string;
  command?: string;
  path?: string;
  name?: string;
  tool?: string;
  server?: string;
  status?: string;
  arguments?: unknown;
  changes?: Array<{ path?: string; kind?: string }>;
}

export interface CodexJsonlEvent {
  type: string;
  thread_id?: string;
  item?: CodexJsonlItem;
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

/** The CLI exceeded an explicitly configured hard execution boundary and was terminated. */
export class CodexTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Codex CLI timed out after ${Math.round(timeoutMs / 60_000)} minutes.`);
    this.name = 'CodexTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

interface ExecaLikeError {
  stdout?: unknown;
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
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
  listener: ((event: CodexJsonlEvent) => void) | undefined,
  event: CodexJsonlEvent,
): void {
  if (!listener) return;
  try {
    listener(event);
  } catch {
    // Progress reporting is observational: a UI callback must never terminate the agent turn.
  }
}

/** Attaches before awaiting execa so JSONL is observable while the child is still running. */
function observeJsonlEvents(
  stdout: unknown,
  listener: ((event: CodexJsonlEvent) => void) | undefined,
): boolean {
  if (!listener || !isJsonlReadable(stdout)) return false;

  let pending = '';
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      notifyEvent(listener, JSON.parse(trimmed) as CodexJsonlEvent);
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
  listener: ((event: CodexJsonlEvent) => void) | undefined,
): void {
  for (const event of parseJsonlEvents(stdout)) notifyEvent(listener, event);
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

function toTimeout(error: unknown, timeoutMs: number | undefined): CodexTimeoutError | null {
  return timeoutMs !== undefined && isExecaLikeError(error) && error.timedOut === true
    ? new CodexTimeoutError(timeoutMs)
    : null;
}

export async function runCodexHeadless(options: RunHeadlessOptions): Promise<RunHeadlessResult> {
  const timeoutMs = options.timeoutMs;
  // Codex has no per-directory allowlist analogous to Claude's --add-dir when running without a
  // sandbox: `--dangerously-bypass-approvals-and-sandbox` already grants unrestricted filesystem
  // access, so additionalDirs is always satisfied under 'bypassPermissions' — the only permission
  // mode ARCH's agents actually dispatch headless with. Any other combination has no CLI
  // equivalent to honor it.
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
      args.push('--dangerously-bypass-approvals-and-sandbox');
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
    args.push('resume', options.resumeSessionId, '-');
  } else {
    args.push('-');
  }

  let stdout: string;
  let observingLiveStream = false;
  try {
    const subprocess = execa('codex', args, {
      cwd: options.cwd,
      cancelSignal: options.signal,
      // Codex treats any piped stdin as extra context even when a positional prompt exists. Pass
      // the complete prompt through its documented `-` sentinel instead: execa writes `input` and
      // closes the pipe, so the CLI can never wait forever for an EOF that ARCH forgot to send.
      input: options.prompt,
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    });
    observingLiveStream = observeJsonlEvents(
      (subprocess as unknown as { stdout?: unknown }).stdout,
      options.onEvent,
    );
    ({ stdout } = await subprocess);
    // Unit-test fakes and custom execa adapters may only expose captured stdout after awaiting.
    if (!observingLiveStream) replayEvents(stdout, options.onEvent);
  } catch (error) {
    if (!isExecaLikeError(error)) throw error;
    if (!observingLiveStream) replayEvents(error.stdout, options.onEvent);
    const events = parseJsonlEvents(error.stdout);
    throw (
      toTimeout(error, timeoutMs) ??
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
