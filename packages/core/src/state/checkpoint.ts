import { readFile, writeFile } from 'node:fs/promises';
import { type NewTaskSpec, type TasksIndex, TasksIndexSchema } from '@losina/schemas';
import { parse, stringify } from 'yaml';

export async function loadTasksIndex(path: string): Promise<TasksIndex> {
  const raw = await readFile(path, 'utf-8');
  return TasksIndexSchema.parse(parse(raw));
}

export async function saveTasksIndex(path: string, index: TasksIndex): Promise<void> {
  const validated = TasksIndexSchema.parse(index);
  await writeFile(path, stringify(validated), 'utf-8');
}

/**
 * Appends brand-new tasks to an already-approved plan — e.g. ones the Architect decided to add
 * from a chat turn — mutating `tasksIndex.tasks` in place, the same style `applyQueuedRetries` in
 * `implementation-phase.ts` already uses for its own in-memory mutations. Every existing task is
 * left untouched; a new task always starts life exactly like one from Definition phase does
 * (`pending`, no corrections, no retries yet).
 */
export function mergeNewTasks(tasksIndex: TasksIndex, newTasks: NewTaskSpec[]): void {
  const existingIds = new Set(tasksIndex.tasks.map((task) => task.id));
  for (const spec of newTasks) {
    if (existingIds.has(spec.id)) {
      throw new Error(`Task id already exists: ${spec.id}`);
    }
    existingIds.add(spec.id);
  }
  for (const spec of newTasks) {
    tasksIndex.tasks.push({ ...spec, status: 'pending', correctionFiles: [], retries: 0 });
  }
}
