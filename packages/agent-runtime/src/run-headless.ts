import {
  ClaudeApiRejectionError,
  type ClaudeJsonlEvent,
  ClaudeStreamAbortedError,
  runClaudeHeadless,
} from '@losina/claude-runtime';
import {
  CodexApiRejectionError,
  type CodexJsonlEvent,
  CodexStreamAbortedError,
  CodexTimeoutError,
  runCodexHeadless,
} from '@losina/codex-runtime';
import {
  OpencodeApiRejectionError,
  type OpencodeJsonlEvent,
  OpencodeStreamAbortedError,
  runOpencodeHeadless,
} from '@losina/opencode-runtime';
import {
  type AgentProgressEvent,
  progressFromClaudeEvent,
  progressFromCodexEvent,
  progressFromOpencodeEvent,
} from './progress.js';
import { detectProvider } from './provider.js';

export type PermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';

export interface RunAgentHeadlessOptions {
  prompt: string;
  model: string;
  cwd: string;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  signal?: AbortSignal;
  additionalDirs?: string[];
  /** Receives sanitized, provider-neutral activity while the turn is still running. */
  onProgress?: (progress: AgentProgressEvent) => void;
}

export interface RunAgentHeadlessResult {
  sessionId: string;
  output: string;
}

/**
 * Single entry point every ARCH agent (Architect, TL, Worker) dispatches through. Picks the
 * CLI — Claude Code, Codex, or OpenCode — purely from `options.model`, so a run can mix models
 * from any provider across roles without any caller needing to know which binary actually ran.
 */
export async function runAgentHeadless(
  options: RunAgentHeadlessOptions,
): Promise<RunAgentHeadlessResult> {
  const { onProgress, ...runtimeOptions } = options;
  const report = (progress: AgentProgressEvent | undefined) => {
    if (progress) onProgress?.(progress);
  };

  switch (detectProvider(options.model)) {
    case 'codex':
      return runCodexHeadless({
        ...runtimeOptions,
        onEvent: onProgress
          ? (event: CodexJsonlEvent) => report(progressFromCodexEvent(event, options.cwd))
          : undefined,
      });
    case 'opencode':
      return runOpencodeHeadless({
        ...runtimeOptions,
        onEvent: onProgress
          ? (event: OpencodeJsonlEvent) => report(progressFromOpencodeEvent(event, options.cwd))
          : undefined,
      });
    case 'claude':
      return runClaudeHeadless({
        ...runtimeOptions,
        onEvent: onProgress
          ? (event: ClaudeJsonlEvent) => report(progressFromClaudeEvent(event, options.cwd))
          : undefined,
      });
  }
}

/**
 * True for an infrastructure-level dispatch failure that is safe to retry in the same working
 * directory regardless of which provider ran it. A timeout or interrupted stream may have left
 * useful partial files behind; keeping the working directory lets the next turn inspect and
 * finish that work. Callers that need provider-specific detail (e.g. Claude's billed cost,
 * Codex's timeout) can still inspect the underlying error classes directly; this is only for the
 * shared retry decision.
 */
export function isTransientDispatchError(error: unknown): boolean {
  return (
    error instanceof ClaudeApiRejectionError ||
    error instanceof ClaudeStreamAbortedError ||
    error instanceof CodexApiRejectionError ||
    error instanceof CodexStreamAbortedError ||
    error instanceof CodexTimeoutError ||
    error instanceof OpencodeApiRejectionError ||
    error instanceof OpencodeStreamAbortedError
  );
}

export function describeTransientDispatchFailure(error: unknown): string {
  if (error instanceof CodexTimeoutError) {
    return 'dispatch timed out';
  }
  if (
    error instanceof ClaudeApiRejectionError ||
    error instanceof CodexApiRejectionError ||
    error instanceof OpencodeApiRejectionError
  ) {
    return 'dispatch rejected before execution';
  }
  return 'dispatch aborted mid-stream';
}
