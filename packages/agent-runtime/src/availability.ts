import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentProvider } from './provider.js';

const BINARY_BY_PROVIDER: Record<AgentProvider, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
};

const CHECK_TIMEOUT_MS = 2000;

const execFileAsync = promisify(execFile);

function isPathMiss(error: unknown): boolean {
  // Any failure other than "the shell couldn't find this binary at all" still proves it's on
  // PATH — a non-zero exit, an unsupported --version flag, or the timeout firing above all
  // mean the CLI exists and ran, it just didn't behave the way this probe expected.
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isBinaryOnPath(binary: string): boolean {
  try {
    execFileSync(binary, ['--version'], { stdio: 'ignore', timeout: CHECK_TIMEOUT_MS });
    return true;
  } catch (error) {
    return !isPathMiss(error);
  }
}

async function isBinaryOnPathAsync(binary: string): Promise<boolean> {
  try {
    await execFileAsync(binary, ['--version'], { timeout: CHECK_TIMEOUT_MS });
    return true;
  } catch (error) {
    return !isPathMiss(error);
  }
}

/**
 * Which of the three CLIs ARCH can dispatch to are actually installed on this machine, checked
 * by attempting to run each with `--version`. Lets the model picker hide a provider it can't
 * actually use instead of offering a choice that would only fail once dispatched.
 */
export function detectInstalledProviders(): Set<AgentProvider> {
  return new Set(
    (Object.keys(BINARY_BY_PROVIDER) as AgentProvider[]).filter((provider) =>
      isBinaryOnPath(BINARY_BY_PROVIDER[provider]),
    ),
  );
}

/**
 * Same check as {@link detectInstalledProviders}, but non-blocking: the three CLI probes run
 * concurrently via `execFile` instead of sequentially via `execFileSync`, so callers on a UI
 * thread (e.g. the model picker) can keep animating a spinner while this resolves.
 */
export async function detectInstalledProvidersAsync(): Promise<Set<AgentProvider>> {
  const providers = Object.keys(BINARY_BY_PROVIDER) as AgentProvider[];
  const installed = await Promise.all(
    providers.map((provider) => isBinaryOnPathAsync(BINARY_BY_PROVIDER[provider])),
  );
  return new Set(providers.filter((_provider, index) => installed[index]));
}
