import type { RunMeta, Task } from '@losina/schemas';
import { describe, expect, it } from 'vitest';
import { resolveTaskRepoRoot } from './task-repo-root.js';

const run: RunMeta = {
  runId: 'run-1',
  title: 'Test run',
  prompt: 'do something',
  cwd: '/workspace',
  phase: 'implementation',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const task: Task = {
  id: 'TASK-001',
  title: 'Add a function',
  status: 'pending',
  dependsOn: [],
  file: 'tasks/TASK-001.md',
  correctionFiles: [],
  retries: 0,
  checks: [],
  scope: [],
};

describe('resolveTaskRepoRoot', () => {
  it('falls back to run.cwd when the task has no repoRoot', () => {
    expect(resolveTaskRepoRoot(run, task)).toBe('/workspace');
  });

  it("uses the task's own repoRoot when set", () => {
    expect(resolveTaskRepoRoot(run, { ...task, repoRoot: '/workspace/service-a' })).toBe(
      '/workspace/service-a',
    );
  });
});
