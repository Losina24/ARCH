import type { AgentActivityEvent } from '@arch/ipc';
import type { Task, TasksIndex } from '@arch/schemas';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { DagGraph } from './dag-graph.js';

const WIDTH = 60;

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

describe('DagGraph', () => {
  it('shows a waiting message when there is no plan yet', () => {
    const { lastFrame } = render(
      <DagGraph tasksIndex={null} events={[]} agentLabels={new Map()} width={WIDTH} />,
    );
    expect(lastFrame()).toContain(
      'Task graph will appear here once the Architect finishes planning.',
    );
  });

  it('shows an empty-plan message when the plan has no tasks', () => {
    const tasksIndex: TasksIndex = { tasks: [] };
    const { lastFrame } = render(
      <DagGraph tasksIndex={tasksIndex} events={[]} agentLabels={new Map()} width={WIDTH} />,
    );
    expect(lastFrame()).toContain('The plan has no tasks.');
  });

  it('centers a single card within the available width', () => {
    const tasksIndex: TasksIndex = { tasks: [task({ id: 'TASK-001' })] };
    const { lastFrame } = render(
      <DagGraph tasksIndex={tasksIndex} events={[]} agentLabels={new Map()} width={WIDTH} />,
    );
    const frame = lastFrame() ?? '';
    const borderLine = frame.split('\n').find((line) => line.includes('TASK-001'));
    expect(borderLine).toBeDefined();
    const leadingSpaces = (borderLine ?? '').match(/^ */)?.[0].length ?? 0;
    expect(leadingSpaces).toBeGreaterThan(5);
  });

  it('wires a wave to the next with a bus connector when both waves are single rows', () => {
    const tasksIndex: TasksIndex = {
      tasks: [
        task({ id: 'TASK-001', title: 'Setup', dependsOn: [] }),
        task({ id: 'TASK-002', title: 'Build UI', dependsOn: ['TASK-001'] }),
      ],
    };
    const { lastFrame } = render(
      <DagGraph tasksIndex={tasksIndex} events={[]} agentLabels={new Map()} width={WIDTH} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TASK-001');
    expect(frame).toContain('TASK-002');
    expect(frame).toMatch(/[┬┴┼]/);
  });

  it('keeps a wave on a single row using compact cards when full cards would not fit, so the bus connector wires every child', () => {
    const tasksIndex: TasksIndex = {
      tasks: [
        task({ id: 'TASK-001', title: 'Setup', dependsOn: [] }),
        task({ id: 'TASK-002', title: 'Build UI', dependsOn: ['TASK-001'] }),
        task({ id: 'TASK-003', title: 'Build API', dependsOn: ['TASK-001'] }),
      ],
    };
    // Two full-size cards need 2*26+2=54 columns — would wrap into two rows
    // and lose the graphical connector. At 40 columns, compact cards
    // (2*16+2=34) fit both siblings on a single row instead.
    const { lastFrame } = render(
      <DagGraph tasksIndex={tasksIndex} events={[]} agentLabels={new Map()} width={40} />,
    );
    const frame = lastFrame() ?? '';
    const sharedRow = frame
      .split('\n')
      .find((line) => line.includes('TASK-002') && line.includes('TASK-003'));
    expect(sharedRow).toBeDefined();
    expect(frame).toMatch(/[┬┴┼]/);
    expect(frame).not.toContain('←');
    // Compact mode drops the title line for the wrapped-avoiding cards.
    expect(frame).not.toContain('Build UI');
    expect(frame).not.toContain('Build API');
  });

  it('still draws a real graphical connector, not text, when a wave has to wrap even with compact cards', () => {
    const tasksIndex: TasksIndex = {
      tasks: [
        task({ id: 'TASK-001', title: 'Setup', dependsOn: [] }),
        task({ id: 'TASK-002', title: 'Config', dependsOn: [] }),
        task({ id: 'TASK-003', title: 'Build UI', dependsOn: ['TASK-001', 'TASK-002'] }),
      ],
    };
    const { lastFrame } = render(
      <DagGraph tasksIndex={tasksIndex} events={[]} agentLabels={new Map()} width={30} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TASK-001');
    expect(frame).toContain('TASK-002');
    expect(frame).toContain('TASK-003');
    expect(frame).toMatch(/[┬┴┼]/);
    expect(frame).not.toContain('←');
    expect(frame).not.toContain('▼');
  });

  it('resolves the assigned agent label for a task from the latest activity event', () => {
    const tasksIndex: TasksIndex = { tasks: [task({ id: 'TASK-001' })] };
    const events: AgentActivityEvent[] = [
      {
        type: 'agent:activity',
        runId: 'run-1',
        agentId: 'worker-1',
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
    ];
    const agentLabels = new Map([['worker-1', 'Worker 1']]);
    const { lastFrame } = render(
      <DagGraph tasksIndex={tasksIndex} events={events} agentLabels={agentLabels} width={WIDTH} />,
    );
    expect(lastFrame()).toContain('Agent: Worker 1');
  });

  it('marks the selected task card with cursor glyphs around its id', () => {
    const tasksIndex: TasksIndex = { tasks: [task({ id: 'TASK-001' })] };
    const { lastFrame } = render(
      <DagGraph
        tasksIndex={tasksIndex}
        events={[]}
        agentLabels={new Map()}
        width={WIDTH}
        selectedTaskId="TASK-001"
      />,
    );
    expect(lastFrame() ?? '').toContain('❯TASK-001❯');
  });

  it('shows an error message instead of crashing when the plan has a dependency cycle', () => {
    const tasksIndex: TasksIndex = {
      tasks: [
        task({ id: 'TASK-001', dependsOn: ['TASK-002'] }),
        task({ id: 'TASK-002', dependsOn: ['TASK-001'] }),
      ],
    };
    const { lastFrame } = render(
      <DagGraph tasksIndex={tasksIndex} events={[]} agentLabels={new Map()} width={WIDTH} />,
    );
    expect(lastFrame() ?? '').not.toBe('');
  });
});
