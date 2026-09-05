import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task, TasksIndex } from '@losina/schemas';
import type { DependencyBrief } from '@losina/tl';

const SUMMARY_MAX_CHARS = 1000;

async function readDependencySummary(runDir: string, dep: Task): Promise<string | undefined> {
  try {
    const markdown = await readFile(join(runDir, dep.file), 'utf-8');
    return markdown.length > SUMMARY_MAX_CHARS
      ? `${markdown.slice(0, SUMMARY_MAX_CHARS)}…`
      : markdown;
  } catch {
    // The dependency's own task file is missing/unreadable — degrade to no summary rather than
    // failing this task's dispatch over a problem that isn't this task's own.
    return undefined;
  }
}

/**
 * Resolves a task's `dependsOn` ids to the identity a dependent task's Worker needs to treat
 * them as a fixed contract to build on: id, title, and declared scope, in `dependsOn` order.
 * Unresolvable ids are skipped rather than thrown on — there's no plan-time validation that
 * every `dependsOn` entry references a real task, so a hallucinated id must degrade to "no
 * context" for that one entry, never abort the whole dispatch.
 *
 * When a dependency declared no `scope` (nothing to point the Worker at), falls back to a short
 * excerpt of that dependency's own task markdown instead, so the Worker still has some idea what
 * it's building on.
 */
export async function resolveDependencyBriefs(
  tasksIndex: TasksIndex,
  task: Task,
  runDir: string,
): Promise<DependencyBrief[]> {
  const briefs: DependencyBrief[] = [];
  for (const depId of task.dependsOn) {
    const dep = tasksIndex.tasks.find((candidate) => candidate.id === depId);
    if (!dep) continue;
    const brief: DependencyBrief = { id: dep.id, title: dep.title, scope: dep.scope };
    if (dep.scope.length === 0) {
      const summary = await readDependencySummary(runDir, dep);
      if (summary !== undefined) brief.summary = summary;
    }
    briefs.push(brief);
  }
  return briefs;
}
