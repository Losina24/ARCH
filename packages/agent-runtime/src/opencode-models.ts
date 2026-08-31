import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const LIST_TIMEOUT_MS = 5000;

/**
 * Live model catalog for OpenCode, fetched via `opencode models`. Unlike Claude/Codex, which
 * expose a small fixed set of models, OpenCode's available models depend entirely on which
 * upstream providers the user has authenticated — so there's no static list to fall back on,
 * only an empty result when the CLI is missing, unauthenticated, or the command fails.
 */
export async function listOpenCodeModels(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('opencode', ['models'], { timeout: LIST_TIMEOUT_MS });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
