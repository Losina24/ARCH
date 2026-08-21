import { describe, expect, it } from 'vitest';
import { TaskSchema, TaskStatusSchema, TasksIndexSchema } from './task.js';

const validTask = {
  id: 'TASK-001',
  title: 'Add a function',
  status: 'pending',
  dependsOn: [],
  file: 'tasks/TASK-001.md',
  correctionFiles: [],
  retries: 0,
};

describe('TaskStatusSchema', () => {
  it('accepts every known status', () => {
    for (const status of [
      'pending',
      'ready',
      'blocked',
      'in_progress',
      'in_review',
      'needs_correction',
      'done',
      'failed',
      'awaiting_human',
    ]) {
      expect(TaskStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects an unknown status', () => {
    expect(() => TaskStatusSchema.parse('archived')).toThrow();
  });
});

describe('TaskSchema', () => {
  it('parses a minimal valid task and defaults checks and scope to an empty array', () => {
    const task = TaskSchema.parse(validTask);
    expect(task.checks).toEqual([]);
    expect(task.scope).toEqual([]);
  });

  it('parses a task with an explicit scope', () => {
    const task = TaskSchema.parse({ ...validTask, scope: ['apps/some-app/src/'] });
    expect(task.scope).toEqual(['apps/some-app/src/']);
  });

  it('parses a task with explicit checks', () => {
    const task = TaskSchema.parse({
      ...validTask,
      checks: [{ name: 'syntax-check', command: 'node', args: ['--check', 'src/index.js'] }],
    });
    expect(task.checks).toHaveLength(1);
    expect(task.checks[0]?.name).toBe('syntax-check');
  });

  it('rejects negative retries', () => {
    expect(() => TaskSchema.parse({ ...validTask, retries: -1 })).toThrow();
  });

  it('rejects a non-integer retries count', () => {
    expect(() => TaskSchema.parse({ ...validTask, retries: 1.5 })).toThrow();
  });

  it('rejects a missing required field', () => {
    const { file: _file, ...withoutFile } = validTask;
    expect(() => TaskSchema.parse(withoutFile)).toThrow();
  });

  it('parses a task without a failureReason', () => {
    const task = TaskSchema.parse(validTask);
    expect(task.failureReason).toBeUndefined();
  });

  it('parses a failed task carrying a failureReason', () => {
    const task = TaskSchema.parse({
      ...validTask,
      status: 'failed',
      failureReason: 'The following checks failed and must be fixed:\n\n### lint\nexit code 1',
    });
    expect(task.failureReason).toBe(
      'The following checks failed and must be fixed:\n\n### lint\nexit code 1',
    );
  });
});

describe('TasksIndexSchema', () => {
  it('parses a list of tasks', () => {
    const index = TasksIndexSchema.parse({ tasks: [validTask] });
    expect(index.tasks).toHaveLength(1);
  });

  it('rejects a malformed task inside the list', () => {
    expect(() => TasksIndexSchema.parse({ tasks: [{ ...validTask, retries: -1 }] })).toThrow();
  });
});
