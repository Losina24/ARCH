import type { ArchMeshEvent } from '@losina/ipc';
import type { Task } from '@losina/schemas';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { TaskDetailPanel } from './task-detail-panel.js';

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

const baseProps = {
  content: 'Body',
  loading: false,
  error: null,
  events: [] as ArchMeshEvent[],
  width: 80,
  height: 20,
  expanded: false,
};

describe('TaskDetailPanel', () => {
  it('does not show a failure reason section when the task has none', () => {
    const { lastFrame } = render(
      <TaskDetailPanel {...baseProps} task={task({ status: 'pending' })} />,
    );
    expect(lastFrame() ?? '').not.toContain('Failure reason:');
  });

  it('shows the failure reason for a failed task', () => {
    const { lastFrame } = render(
      <TaskDetailPanel
        {...baseProps}
        task={task({ status: 'failed', failureReason: 'The following checks failed: lint' })}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Failure reason:');
    expect(frame).toContain('The following checks failed: lint');
  });

  it('shows a Console module on the left and a Task definition module on the right', () => {
    const { lastFrame } = render(<TaskDetailPanel {...baseProps} task={task({})} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Console');
    expect(frame).toContain('Task definition');
    expect(frame).toContain('Body');
  });

  it("shows the task's own worker activity in the Console module, scoped to that task", () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId: 'run-1',
        agentId: 'worker-TASK-001',
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
    ];
    const { lastFrame } = render(
      <TaskDetailPanel {...baseProps} task={task({})} events={events} />,
    );
    expect(lastFrame()).toContain('sent prompt · TASK-001');
  });

  it('shows status-change logs for the task even before any worker activity exists', () => {
    const events: ArchMeshEvent[] = [
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-001', status: 'blocked' },
    ];
    const { lastFrame } = render(
      <TaskDetailPanel {...baseProps} task={task({ status: 'blocked' })} events={events} />,
    );
    expect(lastFrame() ?? '').not.toContain('No activity yet for this task.');
  });

  it("does not leak another task's worker activity into this task's Console", () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId: 'run-1',
        agentId: 'worker-TASK-999',
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-999',
      },
    ];
    const { lastFrame } = render(
      <TaskDetailPanel {...baseProps} task={task({})} events={events} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('TASK-999');
    expect(frame).toContain('No activity yet for this task.');
  });

  it('hides the Task definition module and widens Console when expanded', () => {
    const { lastFrame } = render(
      <TaskDetailPanel {...baseProps} task={task({})} expanded={true} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Console');
    expect(frame).not.toContain('Task definition');
    expect(frame).not.toContain('Body');
  });
});
