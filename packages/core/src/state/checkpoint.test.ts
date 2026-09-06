import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewTaskSpec, TasksIndex } from '@losina/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTasksIndex, mergeNewTasks, saveTasksIndex } from './checkpoint.js';

describe('loadTasksIndex / saveTasksIndex', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arch-checkpoint-test-'));
    path = join(dir, 'tasks-index.yaml');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a tasks index through YAML', async () => {
    const index: TasksIndex = {
      tasks: [
        {
          id: 'TASK-001',
          title: 'Add add(a, b)',
          status: 'pending',
          dependsOn: [],
          file: 'tasks/TASK-001.md',
          correctionFiles: [],
          retries: 0,
          checks: [{ name: 'syntax-check', command: 'node', args: ['--check', 'src/index.js'] }],
          scope: [],
        },
      ],
    };

    await saveTasksIndex(path, index);
    expect(await loadTasksIndex(path)).toEqual(index);
  });

  it('rejects saving an index with an invalid task', async () => {
    const invalid = { tasks: [{ id: 'TASK-001' }] } as unknown as TasksIndex;
    await expect(saveTasksIndex(path, invalid)).rejects.toThrow();
  });

  it('propagates a missing-file error from loadTasksIndex', async () => {
    await expect(loadTasksIndex(join(dir, 'missing.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('mergeNewTasks', () => {
  const existingTask: TasksIndex['tasks'][number] = {
    id: 'TASK-001',
    title: 'Add add(a, b)',
    status: 'done',
    dependsOn: [],
    file: 'tasks/TASK-001.md',
    correctionFiles: [],
    retries: 0,
    checks: [],
    scope: [],
  };

  const newTask: NewTaskSpec = {
    id: 'TASK-002',
    title: 'Add subtract(a, b)',
    dependsOn: ['TASK-001'],
    file: 'tasks/TASK-002.md',
    checks: [],
    scope: [],
  };

  it('appends a new task starting pending, with no corrections or retries yet', () => {
    const tasksIndex: TasksIndex = { tasks: [existingTask] };

    mergeNewTasks(tasksIndex, [newTask]);

    expect(tasksIndex.tasks).toEqual([
      existingTask,
      { ...newTask, status: 'pending', correctionFiles: [], retries: 0 },
    ]);
  });

  it('leaves every existing task untouched', () => {
    const tasksIndex: TasksIndex = { tasks: [existingTask] };

    mergeNewTasks(tasksIndex, [newTask]);

    expect(tasksIndex.tasks[0]).toEqual(existingTask);
  });

  it('rejects a new task whose id already exists, without adding anything', () => {
    const tasksIndex: TasksIndex = { tasks: [existingTask] };

    expect(() => mergeNewTasks(tasksIndex, [{ ...newTask, id: 'TASK-001' }])).toThrow(
      'Task id already exists: TASK-001',
    );
    expect(tasksIndex.tasks).toEqual([existingTask]);
  });
});
