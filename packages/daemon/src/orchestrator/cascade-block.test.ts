import type { Task } from '@losina/schemas';
import { describe, expect, it } from 'vitest';
import { cascadeBlockDependentTasks } from './cascade-block.js';

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: overrides.id,
    status: 'pending',
    dependsOn: [],
    file: `tasks/${overrides.id}.md`,
    correctionFiles: [],
    retries: 0,
    checks: [],
    ...overrides,
  };
}

describe('cascadeBlockDependentTasks', () => {
  it('returns no ids and changes nothing when there are no failed tasks', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B', dependsOn: ['A'] })];
    const result = cascadeBlockDependentTasks(tasks);
    expect(result).toEqual([]);
    expect(tasks.every((task) => task.status === 'pending')).toBe(true);
  });

  it('blocks a pending task that directly depends on a failed task', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'failed' }),
      makeTask({ id: 'B', dependsOn: ['A'] }),
    ];
    const result = cascadeBlockDependentTasks(tasks);
    expect(result).toEqual(['B']);
    expect(tasks[1]?.status).toBe('blocked');
  });

  it('cascades transitively through a dependency chain', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'failed' }),
      makeTask({ id: 'B', dependsOn: ['A'] }),
      makeTask({ id: 'C', dependsOn: ['B'] }),
    ];
    const result = cascadeBlockDependentTasks(tasks);
    expect(result).toEqual(['B', 'C']);
    expect(tasks[1]?.status).toBe('blocked');
    expect(tasks[2]?.status).toBe('blocked');
  });

  it('does not touch tasks that are already in a non-pending status', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'failed' }),
      makeTask({ id: 'B', dependsOn: ['A'], status: 'done' }),
      makeTask({ id: 'C', dependsOn: ['A'], status: 'in_progress' }),
    ];
    const result = cascadeBlockDependentTasks(tasks);
    expect(result).toEqual([]);
    expect(tasks[1]?.status).toBe('done');
    expect(tasks[2]?.status).toBe('in_progress');
  });

  it('leaves unrelated pending tasks untouched', () => {
    const tasks = [makeTask({ id: 'A', status: 'failed' }), makeTask({ id: 'B' })];
    const result = cascadeBlockDependentTasks(tasks);
    expect(result).toEqual([]);
    expect(tasks[1]?.status).toBe('pending');
  });

  it('keeps the originally failed task as failed, never overwriting it with blocked', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'failed' }),
      makeTask({ id: 'B', dependsOn: ['A'] }),
    ];
    cascadeBlockDependentTasks(tasks);
    expect(tasks[0]?.status).toBe('failed');
  });

  it('blocks a pending task that directly depends on an awaiting_human task', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'awaiting_human' }),
      makeTask({ id: 'B', dependsOn: ['A'] }),
    ];
    const result = cascadeBlockDependentTasks(tasks);
    expect(result).toEqual(['B']);
    expect(tasks[1]?.status).toBe('blocked');
  });

  it('cascades through a task that was already blocked by an earlier run of this function', () => {
    const tasks = [
      makeTask({ id: 'A', status: 'failed' }),
      makeTask({ id: 'B', status: 'blocked', dependsOn: ['A'] }),
      makeTask({ id: 'C', dependsOn: ['B'] }),
    ];
    const result = cascadeBlockDependentTasks(tasks);
    expect(result).toEqual(['C']);
    expect(tasks[2]?.status).toBe('blocked');
  });
});
