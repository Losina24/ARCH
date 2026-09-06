import { access, readFile, realpath } from 'node:fs/promises';
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

/** Idempotent: a no-op (exit code != 0, swallowed) when there is no merge in progress. */
export async function abortMerge(cwd: string): Promise<void> {
  await execa('git', ['merge', '--abort'], { cwd, reject: false });
}

/** Files Git currently considers unmerged (conflict markers may or may not still be present —
 * see hasConflictMarkers for that). Empty once nothing is mid-merge. */
export async function listConflictedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execa('git', ['diff', '--name-only', '--diff-filter=U'], { cwd });
  return stdout.split('\n').filter(Boolean);
}

/**
 * Whether any of the given files still contains Git's conflict markers. Needed because
 * dispatchWorker stages every changed file after the Worker runs (see @losina/tl's
 * dispatch-worker.ts), and `git add` clears a file's unmerged bit in the index the moment it's
 * staged — regardless of whether the markers inside it were actually removed. So after a Worker
 * dispatch, listConflictedFiles alone can no longer tell a resolved file from one the Worker just
 * staged as-is, markers and all.
 */
export async function hasConflictMarkers(cwd: string, files: string[]): Promise<boolean> {
  for (const file of files) {
    const content = await readFile(join(cwd, file), 'utf-8').catch(() => '');
    if (content.includes('<<<<<<< ') || content.includes('>>>>>>> ')) return true;
  }
  return false;
}

/**
 * IMPORTANT safety net: repoRoot is the user's real, already-checked-out repository — this must
 * never be left mid-merge (MERGE_HEAD present, conflict-marked files) no matter what happens. On
 * any failure this aborts the merge in repoRoot before rethrowing, so a conflict here can only
 * ever produce a clean failure, never a broken real repo. In the intended flow this never
 * actually conflicts: callers first reconcile the branch against repoRoot's current state inside
 * the disposable worktree (see syncWorktreeWithBase), so by the time this runs it's a guaranteed
 * fast-forward.
 */
export async function mergeWorktree(repoRoot: string, handle: WorktreeHandle): Promise<void> {
  const result = await execa('git', ['merge', handle.branch], { cwd: repoRoot, reject: false });
  if (result.exitCode !== 0) {
    await abortMerge(repoRoot);
    throw new Error(`Failed to merge ${handle.branch} into ${repoRoot}: ${result.stderr}`);
  }
}

/**
 * Merges repoRoot's current base branch INTO the isolated worktree — the opposite direction from
 * mergeWorktree — so that any conflict between this task's work and everything else that has
 * landed on the base since this worktree branched is confined to the disposable worktree, never
 * to the user's real repository. This is exactly what a human developer does before opening a
 * merge/pull request: pull the latest base into their own branch, resolve there, then integrate.
 *
 * Returns the list of conflicted files, or undefined when the merge completed cleanly (including
 * the common case where the worktree was already up to date). Leaves the worktree mid-merge on
 * conflict — the caller is responsible for resolving (or aborting) it.
 */
export async function syncWorktreeWithBase(
  worktree: WorktreeHandle,
  baseBranch: string,
): Promise<string[] | undefined> {
  const result = await execa('git', ['merge', '--no-edit', baseBranch], {
    cwd: worktree.path,
    reject: false,
  });
  if (result.exitCode === 0) return undefined;

  const conflicted = await listConflictedFiles(worktree.path);
  if (conflicted.length === 0) {
    // Failed for some other reason (e.g. the base branch doesn't exist) — not something a
    // correction round can fix, so don't leave the worktree mid-merge for the caller to trip on.
    await abortMerge(worktree.path);
    throw new Error(`Failed to merge ${baseBranch} into ${worktree.path}: ${result.stderr}`);
  }
  return conflicted;
}

/**
 * Guarantees a task's own worktree actually contains its dependencies' work, for the one case
 * where that isn't already true by construction: an approved dependency committed to its own
 * `feat/<id>` branch but was deliberately not merged/deleted (e.g. the run's base branch is
 * protected — see PROTECTED_BRANCH in @losina/daemon's tl-loop), so a fresh worktree branching
 * from repoRoot's current HEAD would otherwise never see it. In the common case (the dependency
 * *was* merged into repoRoot, and its branch deleted as part of that), every one of these is a
 * no-op — repoRoot's HEAD already contains the dependency's commit before this worktree ever
 * branches from it.
 */
export async function mergeDependencyBranches(
  worktree: WorktreeHandle,
  repoRoot: string,
  dependencyTaskIds: string[],
): Promise<void> {
  for (const depId of dependencyTaskIds) {
    const branch = `feat/${depId}`;
    if (!(await branchExists(repoRoot, `refs/heads/${branch}`))) continue;
    await execa('git', ['merge', branch], { cwd: worktree.path });
  }
}

export async function removeWorktree(repoRoot: string, handle: WorktreeHandle): Promise<void> {
  await execa('git', ['worktree', 'remove', handle.path], { cwd: repoRoot });
}

export async function deleteBranch(repoRoot: string, handle: WorktreeHandle): Promise<void> {
  await execa('git', ['branch', '-D', handle.branch], { cwd: repoRoot });
}
