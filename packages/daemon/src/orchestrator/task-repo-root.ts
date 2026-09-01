import type { RunMeta, Task } from '@losina/schemas';

/**
 * The git repository a task's work happens in: its own `repoRoot` when the run spans several
 * repos, falling back to the run's shared `run.cwd` for the common single-repo case.
 */
export function resolveTaskRepoRoot(run: RunMeta, task: Task): string {
  return task.repoRoot ?? run.cwd;
}
