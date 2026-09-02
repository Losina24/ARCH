import { access, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execa } from 'execa';

export interface WorktreeHandle {
  path: string;
  branch: string;
}

interface RegisteredWorktree {
  path: string;
  branchRef?: string;
}

function parseRegisteredWorktrees(output: string): RegisteredWorktree[] {
  return output
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n');
      const pathLine = lines.find((line) => line.startsWith('worktree '));
      const branchLine = lines.find((line) => line.startsWith('branch '));
      return pathLine
        ? {
            path: pathLine.slice('worktree '.length),
            ...(branchLine ? { branchRef: branchLine.slice('branch '.length) } : {}),
          }
        : undefined;
    })
    .filter((entry): entry is RegisteredWorktree => entry !== undefined);
}

async function listRegisteredWorktrees(repoRoot: string): Promise<RegisteredWorktree[]> {
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
  return parseRegisteredWorktrees(stdout);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolve(path);
    throw error;
  }
}

async function branchExists(repoRoot: string, branchRef: string): Promise<boolean> {
  const result = await execa('git', ['show-ref', '--verify', '--quiet', branchRef], {
    cwd: repoRoot,
    reject: false,
  });
  return result.exitCode === 0;
}

export async function createWorktree(
  repoRoot: string,
  worktreesDir: string,
  taskId: string,
): Promise<WorktreeHandle> {
  const branch = `feat/${taskId}`;
  const path = resolve(join(worktreesDir, taskId));
  const branchRef = `refs/heads/${branch}`;
  const registered = await listRegisteredWorktrees(repoRoot);
  const expectedCanonicalPath = await canonicalPath(path);
  const registeredWithCanonicalPaths = await Promise.all(
    registered.map(async (entry) => ({
      ...entry,
      canonicalPath: await canonicalPath(entry.path),
    })),
  );

  const existingAtPath = registeredWithCanonicalPaths.find(
    (entry) => entry.canonicalPath === expectedCanonicalPath,
  );
  if (existingAtPath) {
    if (existingAtPath.branchRef !== branchRef) {
      throw new Error(
        `Cannot reuse worktree ${path}: expected branch ${branch}, found ${existingAtPath.branchRef ?? 'detached HEAD'}.`,
      );
    }
    if (!(await pathExists(path))) {
      throw new Error(
        `Cannot reuse worktree ${path}: Git still registers it but the path is missing.`,
      );
    }
    return { path, branch };
  }

  if (await pathExists(path)) {
    throw new Error(
      `Cannot create worktree ${path}: the path exists but is not registered by Git.`,
    );
  }

  const existingForBranch = registeredWithCanonicalPaths.find(
    (entry) => entry.branchRef === branchRef,
  );
  if (existingForBranch) {
    throw new Error(
      `Cannot create worktree for ${branch}: the branch is already checked out at ${existingForBranch.path}.`,
    );
  }

  if (await branchExists(repoRoot, branchRef)) {
    // A previous failed attempt can remove the worktree registration but leave the feature branch
    // behind. Reattach that branch so its partial commits remain available to the retry.
    await execa('git', ['worktree', 'add', path, branch], { cwd: repoRoot });
  } else {
    await execa('git', ['worktree', 'add', path, '-b', branch], { cwd: repoRoot });
  }
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
