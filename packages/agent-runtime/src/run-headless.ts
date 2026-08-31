import {
  ClaudeApiRejectionError,
  ClaudeStreamAbortedError,
  runClaudeHeadless,
} from '@losina/claude-runtime';
import {
  CodexApiRejectionError,
  CodexStreamAbortedError,
  runCodexHeadless,
} from '@losina/codex-runtime';
import {
  OpencodeApiRejectionError,
  OpencodeStreamAbortedError,
  runOpencodeHeadless,
} from '@losina/opencode-runtime';
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
  switch (detectProvider(options.model)) {
    case 'codex':
      return runCodexHeadless(options);
    case 'opencode':
      return runOpencodeHeadless(options);
    case 'claude':
      return runClaudeHeadless(options);
  }
}

/**
 * True for a dispatch failure that happened before or without producing any usable output —
 * safe to retry unmodified regardless of which provider ran it. Callers that need
 * provider-specific detail (e.g. Claude's billed cost, Codex's exit code) can still import and
 * check the underlying error classes directly; this is only for the shared retry decision.
 */
export function isTransientDispatchError(error: unknown): boolean {
  return (
    error instanceof ClaudeApiRejectionError ||
    error instanceof ClaudeStreamAbortedError ||
    error instanceof CodexApiRejectionError ||
    error instanceof CodexStreamAbortedError ||
    error instanceof OpencodeApiRejectionError ||
    error instanceof OpencodeStreamAbortedError
  );
}

export function describeTransientDispatchFailure(error: unknown): string {
  if (
    error instanceof ClaudeApiRejectionError ||
    error instanceof CodexApiRejectionError ||
    error instanceof OpencodeApiRejectionError
  ) {
    return 'dispatch rejected before execution';
  }
  return 'dispatch aborted mid-stream';
}
