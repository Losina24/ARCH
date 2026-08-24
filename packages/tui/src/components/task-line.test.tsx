import type { Task } from '@losina/schemas';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { TaskLine } from './task-line.js';

function task(overrides: Partial<Task>): Task {
  return {
    id: 'TASK-001',
    title: 'Build the login form',
    status: 'pending',
    dependsOn: [],
    file: 'task-1.md',
    correctionFiles: [],
    retries: 0,
    checks: [],
    ...overrides,
  };
}

describe('TaskLine', () => {
  it('renders the id and title for a neutral status', () => {
    const { lastFrame } = render(<TaskLine task={task({ status: 'pending' })} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[TASK-001]');
    expect(frame).toContain('Build the login form');
  });

  it('renders done tasks id and title on the same styled line', () => {
    const { lastFrame } = render(<TaskLine task={task({ status: 'done' })} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[TASK-001]');
    expect(frame).toContain('Build the login form');
  });

  it('renders in_progress, in_review, failed, and blocked tasks without throwing', () => {
    for (const status of ['in_progress', 'in_review', 'failed', 'blocked'] as const) {
      const { lastFrame } = render(<TaskLine task={task({ status })} />);
      expect(lastFrame() ?? '').toContain('[TASK-001]');
    }
  });

  it('marks the selected task with a cursor', () => {
    const { lastFrame } = render(<TaskLine task={task({})} selected />);
    const frame = lastFrame() ?? '';
    const line = frame.split('\n').find((candidate) => candidate.includes('TASK-001'));
    expect(line ?? '').toContain('❯');
  });

  it('has no cursor when not selected', () => {
    const { lastFrame } = render(<TaskLine task={task({})} />);
    expect(lastFrame() ?? '').not.toContain('❯');
  });
});
