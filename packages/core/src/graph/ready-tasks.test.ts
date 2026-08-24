import type { Task, TaskStatus } from '@losina/schemas';
import { describe, expect, it } from 'vitest';
import { getReadyTaskIds } from './ready-tasks.js';

function makeTask(id: string, status: TaskStatus, dependsOn: string[] = []): Task {
  return {
    id,
    title: id,
    status,
    dependsOn,
    file: `tasks/${id}.md`,
    correctionFiles: [],
    retries: 0,
    checks: [],
  };
}

describe('getReadyTaskIds', () => {
  it('returns pending tasks with no dependencies', () => {
    expect(getReadyTaskIds([makeTask('A', 'pending')])).toEqual(['A']);
  });

  it('excludes a pending task whose dependency is not done yet', () => {
    const tasks = [makeTask('A', 'in_progress'), makeTask('B', 'pending', ['A'])];
    expect(getReadyTaskIds(tasks)).toEqual([]);
  });

  it('includes a pending task once all its dependencies are done', () => {
    const tasks = [makeTask('A', 'done'), makeTask('B', 'pending', ['A'])];
    expect(getReadyTaskIds(tasks)).toEqual(['B']);
  });

  it('requires every dependency to be done, not just one', () => {
    const tasks = [
      makeTask('A', 'done'),
      makeTask('B', 'in_progress'),
      makeTask('C', 'pending', ['A', 'B']),
    ];
    expect(getReadyTaskIds(tasks)).toEqual([]);
  });

  it('ignores tasks that are not pending, even with satisfied dependencies', () => {
    const tasks = [makeTask('A', 'done'), makeTask('B', 'done', ['A']), makeTask('C', 'failed')];
    expect(getReadyTaskIds(tasks)).toEqual([]);
  });

  it('a failed dependency never unblocks its dependent', () => {
    const tasks = [makeTask('A', 'failed'), makeTask('B', 'pending', ['A'])];
    expect(getReadyTaskIds(tasks)).toEqual([]);
  });
});
