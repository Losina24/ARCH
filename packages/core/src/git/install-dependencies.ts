import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Maps each package manager's lockfile to the install command that respects it exactly
 * (no version resolution drift from the commit the worktree was branched from). Checked
 * in this order so a repo that happens to carry more than one lockfile still picks a
 * single, deterministic manager instead of running several installs against the same tree.
 */
const INSTALL_COMMANDS: ReadonlyArray<{ lockfile: string; command: string; args: string[] }> = [
  { lockfile: 'pnpm-lock.yaml', command: 'pnpm', args: ['install', '--frozen-lockfile'] },
  { lockfile: 'yarn.lock', command: 'yarn', args: ['install', '--frozen-lockfile'] },
  { lockfile: 'package-lock.json', command: 'npm', args: ['ci'] },
  { lockfile: 'bun.lockb', command: 'bun', args: ['install', '--frozen-lockfile'] },
];

/**
 * A fresh `git worktree add` only checks out tracked files, so a Node project's
 * node_modules — always gitignored — never exists in a new worktree. Without this, every
 * automated check that needs installed dependencies (build, test, lint) fails there no
 * matter how correct the Worker's change is, and that failure looks identical to a real
 * code problem, burning a correction retry it can never fix by changing code.
 *
 * No-ops for any repo without a recognized lockfile at its root (non-JS projects, or JS
 * projects that don't commit one) — there is no generically safe command to run for those.
 */
export async function installWorktreeDependencies(worktreePath: string): Promise<void> {
  for (const { lockfile, command, args } of INSTALL_COMMANDS) {
    if (await fileExists(join(worktreePath, lockfile))) {
      await execa(command, args, { cwd: worktreePath });
      return;
    }
  }
}
