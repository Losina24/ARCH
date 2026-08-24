import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TasksIndex } from '@losina/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTasksIndex, saveTasksIndex } from './checkpoint.js';

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
