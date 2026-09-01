import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execa } from 'execa';

/**
 * Resolves `cwd` to the root of the git repository it's inside of (or a subdirectory of),
 * rather than trusting `cwd` verbatim. Without this, a TUI/CLI launched from the user's home
 * directory (or any non-repo path) silently produces a run whose `run.cwd` isn't a git
 * repository at all — every later `git status`/`git worktree add` call then fails with an
 * opaque "fatal: not a git repository" deep inside the task pipeline instead of a clear error
 * up front.
 */
export async function resolveRepoRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--show-toplevel'], { cwd });
    return stdout.trim();
  } catch {
    throw new Error(
      `"${cwd}" is not inside a git repository (or any of its parent directories). Run ARCH from inside a git repository, or pass --cwd pointing to one.`,
    );
  }
}

/**
 * Lists the immediate subdirectories of `dir` that are themselves git repository roots (they
 * have their own `.git`, as a directory for a normal clone or a file for a worktree/submodule).
 * Used to support launching ARCH from a folder that isn't a repo itself but holds several
 * independent ones — each task then picks whichever of these it belongs to via `Task.repoRoot`.
 */
export async function discoverReposIn(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const repos: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(dir, entry.name);
    try {
      await stat(join(candidate, '.git'));
      repos.push(candidate);
    } catch {
      // Not a git repo — skip.
    }
  }
  return repos;
}

/**
 * Resolves the working directory for a whole run, allowing two shapes: `cwd` is itself a git
 * repository (the common case — behaves exactly like `resolveRepoRoot`), or `cwd` is a plain
 * folder containing one or more git repositories as immediate subdirectories, in which case it's
 * returned as-is so individual tasks can each pick their own repo (see `Task.repoRoot`). Only
 * throws when neither shape applies, i.e. there's no repository to be found at all.
 */
export async function resolveRunCwd(cwd: string): Promise<string> {
  try {
    return await resolveRepoRoot(cwd);
  } catch (singleRepoError) {
    const repos = await discoverReposIn(cwd);
    if (repos.length > 0) return resolve(cwd);
    throw singleRepoError;
  }
}
