import { execa } from 'execa';
import { resolveModelId } from './model-registry.js';

export type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';

export interface RunHeadlessOptions {
  prompt: string;
  model: string;
  cwd: string;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  signal?: AbortSignal;
  /** Receives each `stream-json` event as soon as Claude Code writes its JSONL line. */
  onEvent?: (event: ClaudeJsonlEvent) => void;
  /** Extra directories the session may read/write outside `cwd` (one `--add-dir` per entry). */
  additionalDirs?: string[];
}

export interface RunHeadlessResult {
  sessionId: string;
  output: string;
}

export interface ClaudeContentBlock {
  type?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
}

export interface ClaudeJsonlEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  terminal_reason?: string;
  total_cost_usd?: number;
  api_error_status?: number | null;
  num_turns?: number;
  attempt?: number;
  max_retries?: number;
  retry_delay_ms?: number;
  message?: { content?: ClaudeContentBlock[] | string };
  event?: { type?: string; content_block?: ClaudeContentBlock };
}

/**
 * The CLI rejected the call outright — e.g. an advisorModel setting incompatible with the
 * request model causes an HTTP 400 — before any turn ran and before anything was billed, as
 * opposed to failing partway through execution. Unambiguously safe to retry unmodified.
 */
export class ClaudeApiRejectionError extends Error {
  readonly apiErrorStatus: number | null;

  constructor(apiErrorStatus: number | null, detail: string) {
    super(
      `Claude CLI rejected the request before execution (HTTP ${apiErrorStatus ?? '?'}): ${detail}`,
    );
    this.name = 'ClaudeApiRejectionError';
    this.apiErrorStatus = apiErrorStatus;
  }
}

/**
 * The CLI's turn loop was cut off mid-response after doing real, billed work (e.g. the
 * underlying model connection dropped mid-stream, terminal_reason: "aborted_streaming") — as
 * opposed to a pre-execution rejection. None of that partial work was ever reported back to the
 * caller, so it's still safe to retry from scratch.
 */
export class ClaudeStreamAbortedError extends Error {
  readonly totalCostUsd: number;

  constructor(terminalReason: string, totalCostUsd: number, numTurns?: number) {
    const turnsPart =
      numTurns === undefined ? '' : ` after ${numTurns} turn${numTurns === 1 ? '' : 's'}`;
    super(
      `Claude CLI aborted mid-response (${terminalReason})${turnsPart}, $${totalCostUsd.toFixed(2)} billed.`,
    );
    this.name = 'ClaudeStreamAbortedError';
    this.totalCostUsd = totalCostUsd;
  }
}

/**
 * Catch-all for any other non-zero exit from the CLI. execa's own `.message`/`.shortMessage`
 * embed the full command line it ran — including the entire `-p <prompt>` argument, which is
 * thousands of characters for a worker dispatch — so it must never be surfaced as-is; this
 * constructs a short, fixed-shape message from just the exit signal instead.
 */
export class ClaudeCliExecutionError extends Error {
  constructor(detail: string) {
    super(`Claude CLI exited unexpectedly (${detail}).`);
    this.name = 'ClaudeCliExecutionError';
  }
}

interface ExecaLikeError {
  stdout?: unknown;
  exitCode?: number;
  signal?: string;
}

// execa always attaches `stdout` (possibly an empty string) to the error it throws for any
// failure that actually spawned the process — a plain, unrelated JS error thrown elsewhere never
// has this property. Used to decide whether a raw execa error is safe to wrap in a short, custom
// message, versus a non-execa error that must be left alone.
function isExecaLikeError(error: unknown): error is ExecaLikeError {
  return typeof error === 'object' && error !== null && 'stdout' in error;
}

// The CLI exits non-zero on both a pre-execution rejection and a mid-stream abort, but still
// writes its JSON result body to stdout in both cases — execa throws, but attaches that stdout
// to the error it throws. Returns null for a crash with no parseable JSON body.
function parseJsonlEvents(stdout: unknown): ClaudeJsonlEvent[] {
  if (typeof stdout !== 'string') return [];
  const events: ClaudeJsonlEvent[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as ClaudeJsonlEvent);
    } catch {
      // Non-JSON line (e.g. a CLI banner) — ignore rather than fail the whole parse.
    }
  }
  return events;
}

function resultEventOf(events: ClaudeJsonlEvent[]): ClaudeJsonlEvent | null {
  return (
    [...events]
      .reverse()
      .find(
        (event) =>
          event.type === 'result' ||
          typeof event.terminal_reason === 'string' ||
          (typeof event.session_id === 'string' && typeof event.result === 'string'),
      ) ?? null
  );
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
  listener: ((event: ClaudeJsonlEvent) => void) | undefined,
  event: ClaudeJsonlEvent,
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
  listener: ((event: ClaudeJsonlEvent) => void) | undefined,
): boolean {
  if (!listener || !isJsonlReadable(stdout)) return false;

  let pending = '';
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      notifyEvent(listener, JSON.parse(trimmed) as ClaudeJsonlEvent);
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
  listener: ((event: ClaudeJsonlEvent) => void) | undefined,
): void {
  for (const event of parseJsonlEvents(stdout)) notifyEvent(listener, event);
}

function toApiRejection(parsed: ClaudeJsonlEvent | null): ClaudeApiRejectionError | null {
  if (!parsed || parsed.terminal_reason !== 'api_error' || parsed.total_cost_usd !== 0) {
    return null;
  }
  return new ClaudeApiRejectionError(parsed.api_error_status ?? null, parsed.result ?? '');
}

function toStreamAbort(parsed: ClaudeJsonlEvent | null): ClaudeStreamAbortedError | null {
  if (
    !parsed ||
    parsed.terminal_reason === undefined ||
    parsed.terminal_reason === 'api_error' ||
    typeof parsed.total_cost_usd !== 'number' ||
    parsed.total_cost_usd <= 0
  ) {
    return null;
  }
  return new ClaudeStreamAbortedError(
    parsed.terminal_reason,
    parsed.total_cost_usd,
    parsed.num_turns,
  );
}

function toGenericExecutionError(error: unknown): ClaudeCliExecutionError | null {
  if (!isExecaLikeError(error)) return null;
  const parts: string[] = [];
  if (typeof error.exitCode === 'number') parts.push(`exit code ${error.exitCode}`);
  if (typeof error.signal === 'string') parts.push(`signal ${error.signal}`);
  return new ClaudeCliExecutionError(
    parts.length > 0 ? parts.join(', ') : 'no exit code — the process may not have started',
  );
}

export async function runClaudeHeadless(options: RunHeadlessOptions): Promise<RunHeadlessResult> {
  const args = [
    '-p',
    options.prompt,
    '--model',
    resolveModelId(options.model),
    '--output-format',
    'stream-json',
    '--verbose',
    // Headless dispatch must not inherit the operator's interactive advisorModel
    // preference: an advisor model incompatible with the request model makes the
    // CLI reject the call outright (HTTP 400) before any turn runs. Passing
    // `--settings '{"advisorModel":null}'` does NOT unset an inherited value — the CLI
    // has no documented "unset" semantics for a scalar key, so the global setting still
    // wins. Excluding the "user" source is the only way to guarantee it's never loaded.
    '--setting-sources',
    'project,local',
  ];

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }
  if (options.permissionMode) {
    args.push('--permission-mode', options.permissionMode);
  }
  for (const dir of options.additionalDirs ?? []) {
    args.push('--add-dir', dir);
  }

  let stdout: string;
  let observingLiveStream = false;
  try {
    // stream-json is the documented real-time format in Claude Code CLI 2.1.x.
    const subprocess = execa('claude', args, {
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
    if (!observingLiveStream && isExecaLikeError(error))
      replayEvents(error.stdout, options.onEvent);
    const parsed = isExecaLikeError(error) ? resultEventOf(parseJsonlEvents(error.stdout)) : null;
    throw (
      toApiRejection(parsed) ?? toStreamAbort(parsed) ?? toGenericExecutionError(error) ?? error
    );
  }

  const parsed = resultEventOf(parseJsonlEvents(stdout));
  if (!parsed?.session_id) {
    throw new ClaudeCliExecutionError(
      'the CLI exited successfully but produced no final result event',
    );
  }

  return {
    sessionId: parsed.session_id,
    output: parsed.result ?? '',
  };
}
