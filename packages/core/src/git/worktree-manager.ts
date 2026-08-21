import { join } from 'node:path';
import { execa } from 'execa';

export interface WorktreeHandle {
  path: string;
  branch: string;
}

export async function createWorktree(
  repoRoot: string,
  worktreesDir: string,
  taskId: string,
): Promise<WorktreeHandle> {
  const branch = `feat/${taskId}`;
  const path = join(worktreesDir, taskId);
  await execa('git', ['worktree', 'add', path, '-b', branch], { cwd: repoRoot });
  return { path, branch };
}

export async function mergeWorktree(repoRoot: string, handle: WorktreeHandle): Promise<void> {
  await execa('git', ['merge', handle.branch], { cwd: repoRoot });
}

export async function removeWorktree(repoRoot: string, handle: WorktreeHandle): Promise<void> {
  await execa('git', ['worktree', 'remove', handle.path], { cwd: repoRoot });
}

export async function deleteBranch(repoRoot: string, handle: WorktreeHandle): Promise<void> {
  await execa('git', ['branch', '-D', handle.branch], { cwd: repoRoot });
}
