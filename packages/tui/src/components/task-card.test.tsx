import type { Task } from '@arch/schemas';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { TaskCard } from './task-card.js';

function task(overrides: Partial<Task>): Task {
  return {
    id: 'TASK-001',
    title: 'Build the login form',
    status: 'pending',
    dependsOn: [],
    file: 'task-1.md',
    correctionFiles: [],
    retries: 2,
    checks: [],
    ...overrides,
  };
}

describe('TaskCard', () => {
  it('shows the task id, title, status, agent, and retry count', () => {
    const { lastFrame } = render(
      <TaskCard task={task({ status: 'ready' })} agentLabel="Worker 1" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TASK-001');
    expect(frame).toContain('Build the login form');
    expect(frame).toContain('ready');
    expect(frame).toContain('Worker 1');
    expect(frame).toContain('Retries: 2');
  });

  it('shows a placeholder when no agent is assigned', () => {
    const { lastFrame } = render(<TaskCard task={task({ status: 'pending' })} agentLabel={null} />);
    expect(lastFrame() ?? '').toContain('Agent: —');
  });

  it('marks the selected card with cursor glyphs around its id', () => {
    const { lastFrame } = render(<TaskCard task={task({})} agentLabel={null} selected />);
    const frame = lastFrame() ?? '';
    const line = frame.split('\n').find((candidate) => candidate.includes('TASK-001'));
    expect(line ?? '').toContain('❯TASK-001❯');
  });

  it('has no cursor glyphs when not selected', () => {
    const { lastFrame } = render(<TaskCard task={task({})} agentLabel={null} />);
    expect(lastFrame() ?? '').not.toContain('❯');
  });

  it('drops the title but keeps id, status, agent, and retries in compact mode', () => {
    const { lastFrame } = render(
      <TaskCard task={task({ status: 'ready' })} agentLabel="W1" compact />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TASK-001');
    expect(frame).not.toContain('Build the login form');
    expect(frame).toContain('ready');
    expect(frame).toContain('Agent: W1');
    expect(frame).toContain('Retries: 2');
  });
});
