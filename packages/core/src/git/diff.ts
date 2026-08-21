import { execa } from 'execa';

export async function stageAll(cwd: string): Promise<void> {
  await execa('git', ['add', '-A'], { cwd });
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  return stdout.trim();
}

/**
 * Lists changed files without touching the index — safe to call while other tasks
 * may concurrently be staging their own (disjoint-scope) changes in the same working
 * directory, which happens when tasks run without worktree isolation.
 */
export async function getChangedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execa('git', ['status', '--porcelain=v1', '--no-renames'], { cwd });
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
}

/** Stages exactly the given paths — unlike `stageAll`, never touches unrelated files. */
export async function stagePaths(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await execa('git', ['add', '--', ...paths], { cwd });
}

/**
 * Diffs exactly the given paths against HEAD without staging them for good — uses
 * intent-to-add so new files show their full content, scoped so it never touches
 * other paths another concurrently-running task might be staging.
 */
export async function getWorkingDiff(cwd: string, paths: string[]): Promise<string> {
  if (paths.length === 0) return '';
  await execa('git', ['add', '-N', '--', ...paths], { cwd });
  const { stdout } = await execa('git', ['diff', '--', ...paths], { cwd });
  return stdout;
}

export async function getStagedDiff(cwd: string): Promise<string> {
  const { stdout } = await execa('git', ['diff', '--cached'], { cwd });
  return stdout;
}

export async function getStagedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execa('git', ['diff', '--cached', '--name-only'], { cwd });
  return stdout.split('\n').filter(Boolean);
}

export async function hasStagedChanges(cwd: string): Promise<boolean> {
  const files = await getStagedFiles(cwd);
  return files.length > 0;
}

export async function commitAll(cwd: string, message: string): Promise<void> {
  await execa('git', ['commit', '--allow-empty', '-m', message], { cwd });
}

/**
 * Undoes exactly the given paths — restores tracked files to their last-committed
 * content and deletes untracked ones. Used to erase a task's own leftover edits when
 * it ends in failure without worktree isolation, so they never leak into a sibling
 * task's change-detection. Each path is handled independently so one path that `git
 * checkout` rejects (e.g. a brand-new untracked file, unknown to HEAD) never blocks the
 * others from being restored.
 */
export async function revertFiles(cwd: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    await execa('git', ['checkout', 'HEAD', '--', path], { cwd }).catch(() => {});
    await execa('git', ['clean', '-fd', '--', path], { cwd }).catch(() => {});
  }
}
