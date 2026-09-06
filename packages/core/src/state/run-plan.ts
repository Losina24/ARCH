import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunPlan } from '@losina/schemas';
import { loadTasksIndex } from './checkpoint.js';

/**
 * Reads a run's project brief and tasks index straight off disk, from its run directory. Returns
 * null once instead of throwing when neither file exists yet (`definition`/`grilling`, before the
 * Architect has written a plan) — the caller decides what "no plan yet" means for it.
 */
export async function loadRunPlan(runDir: string): Promise<RunPlan | null> {
  try {
    const [projectMarkdown, tasksIndex] = await Promise.all([
      readFile(join(runDir, 'project.md'), 'utf-8'),
      loadTasksIndex(join(runDir, 'tasks-index.yaml')),
    ]);
    return { projectMarkdown, tasksIndex };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
