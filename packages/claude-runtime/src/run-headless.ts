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
  /** Extra directories the session may read/write outside `cwd` (one `--add-dir` per entry). */
  additionalDirs?: string[];
}

export interface RunHeadlessResult {
  sessionId: string;
  output: string;
}

interface ClaudeCliJsonOutput {
  session_id: string;
  result: string;
}

interface ClaudeCliErrorJsonOutput {
  terminal_reason?: string;
  total_cost_usd?: number;
  api_error_status?: number | null;
  num_turns?: number;
  result?: string;
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
function parseCliStdoutJson(error: unknown): ClaudeCliErrorJsonOutput | null {
  if (!isExecaLikeError(error) || typeof error.stdout !== 'string') return null;
  try {
    return JSON.parse(error.stdout) as ClaudeCliErrorJsonOutput;
  } catch {
    return null;
  }
}

function toApiRejection(parsed: ClaudeCliErrorJsonOutput | null): ClaudeApiRejectionError | null {
  if (!parsed || parsed.terminal_reason !== 'api_error' || parsed.total_cost_usd !== 0) {
    return null;
  }
  return new ClaudeApiRejectionError(parsed.api_error_status ?? null, parsed.result ?? '');
}

function toStreamAbort(parsed: ClaudeCliErrorJsonOutput | null): ClaudeStreamAbortedError | null {
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
    'json',
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
  try {
    // Output format validated against Claude Code CLI 2.1.x — re-check if it changes in future versions.
    ({ stdout } = await execa('claude', args, {
      cwd: options.cwd,
      cancelSignal: options.signal,
    }));
  } catch (error) {
    const parsed = parseCliStdoutJson(error);
    throw (
      toApiRejection(parsed) ?? toStreamAbort(parsed) ?? toGenericExecutionError(error) ?? error
    );
  }

  const parsed = JSON.parse(stdout) as ClaudeCliJsonOutput;

  return {
    sessionId: parsed.session_id,
    output: parsed.result,
  };
}
