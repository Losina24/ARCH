import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task, TasksIndex } from '@losina/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDependencyBriefs } from './dependency-context.js';

function task(overrides: Partial<Task>): Task {
  return {
    id: 'TASK-001',
    title: 'A task',
    status: 'done',
    dependsOn: [],
    file: 'tasks/TASK-001.md',
    correctionFiles: [],
    retries: 0,
    checks: [],
    scope: [],
    ...overrides,
  };
}

describe('resolveDependencyBriefs', () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'arch-dependency-context-test-'));
    await mkdir(join(runDir, 'tasks'), { recursive: true });
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it('returns an empty list when the task has no dependencies', async () => {
    const tasksIndex: TasksIndex = { tasks: [task({ id: 'TASK-001', dependsOn: [] })] };
    expect(await resolveDependencyBriefs(tasksIndex, tasksIndex.tasks[0], runDir)).toEqual([]);
  });

  it('resolves each dependency to its id, title, and scope, in dependsOn order', async () => {
    const depA = task({ id: 'TASK-A', title: 'Define the Job type', scope: ['src/job.ts'] });
    const depB = task({ id: 'TASK-B', title: 'Define the User type', scope: ['src/user.ts'] });
    const consumer = task({ id: 'TASK-C', dependsOn: ['TASK-B', 'TASK-A'] });
    const tasksIndex: TasksIndex = { tasks: [depA, depB, consumer] };

    const briefs = await resolveDependencyBriefs(tasksIndex, consumer, runDir);

    expect(briefs).toEqual([
      { id: 'TASK-B', title: 'Define the User type', scope: ['src/user.ts'] },
      { id: 'TASK-A', title: 'Define the Job type', scope: ['src/job.ts'] },
    ]);
  });

  it('skips a dependsOn id that does not resolve to a real task, instead of throwing', async () => {
    const consumer = task({ id: 'TASK-C', dependsOn: ['TASK-GHOST'] });
    const tasksIndex: TasksIndex = { tasks: [consumer] };

    await expect(resolveDependencyBriefs(tasksIndex, consumer, runDir)).resolves.toEqual([]);
  });

  it('falls back to an excerpt of the dependency markdown when it declared no scope', async () => {
    const dep = task({ id: 'TASK-A', title: 'Foundations', scope: [], file: 'tasks/TASK-A.md' });
    await writeFile(join(runDir, 'tasks/TASK-A.md'), '# Foundations\n\nSets things up.', 'utf-8');
    const consumer = task({ id: 'TASK-B', dependsOn: ['TASK-A'] });
    const tasksIndex: TasksIndex = { tasks: [dep, consumer] };

    const [brief] = await resolveDependencyBriefs(tasksIndex, consumer, runDir);

    expect(brief?.summary).toBe('# Foundations\n\nSets things up.');
  });

  it('omits the summary when the dependency declared a scope', async () => {
    const dep = task({ id: 'TASK-A', scope: ['src/x.ts'], file: 'tasks/TASK-A.md' });
    await writeFile(join(runDir, 'tasks/TASK-A.md'), '# Whatever', 'utf-8');
    const consumer = task({ id: 'TASK-B', dependsOn: ['TASK-A'] });
    const tasksIndex: TasksIndex = { tasks: [dep, consumer] };

    const [brief] = await resolveDependencyBriefs(tasksIndex, consumer, runDir);

    expect(brief?.summary).toBeUndefined();
  });

  it('omits the summary rather than throwing when the dependency file is missing', async () => {
    const dep = task({ id: 'TASK-A', scope: [], file: 'tasks/missing.md' });
    const consumer = task({ id: 'TASK-B', dependsOn: ['TASK-A'] });
    const tasksIndex: TasksIndex = { tasks: [dep, consumer] };

    const [brief] = await resolveDependencyBriefs(tasksIndex, consumer, runDir);

    expect(brief?.summary).toBeUndefined();
  });
});
