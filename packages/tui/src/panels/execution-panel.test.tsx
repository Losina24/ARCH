import type { AgentActivityEvent, ArchMeshEvent } from '@losina/ipc';
import type { RunPlan } from '@losina/schemas';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { ExecutionPanel } from './execution-panel.js';

function activity(overrides: Partial<AgentActivityEvent>): ArchMeshEvent {
  return {
    type: 'agent:activity',
    runId: 'run-1',
    agentId: 'architect-1',
    role: 'architect',
    state: 'idle-waiting',
    ...overrides,
  } as ArchMeshEvent;
}

describe('ExecutionPanel', () => {
  it('shows the Architect and TL as waiting when there is no plan and no events', () => {
    const { lastFrame } = render(<ExecutionPanel plan={null} events={[]} width={100} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Architect');
    expect(frame).toContain('TL');
    expect(frame).toContain('Waiting');
    expect(frame).toContain('Not ready yet.');
    expect(frame).toContain('Project status');
  });

  it('shows task id and title on the diagram', () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'in_progress',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    const { lastFrame } = render(<ExecutionPanel plan={plan} events={[]} width={100} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TASK-001');
    expect(frame).toContain('Build the login form');
  });

  it('highlights the selected task on the diagram', () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'in_progress',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    const { lastFrame } = render(
      <ExecutionPanel plan={plan} events={[]} width={100} selectedTaskId="TASK-001" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('❯TASK-001❯');
  });

  it('shows the share of finished tasks as a percentage in the Progress module', () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'done',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
          {
            id: 'TASK-002',
            title: 'Wire up the API',
            status: 'in_progress',
            dependsOn: [],
            file: 'task-2.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    const { lastFrame } = render(<ExecutionPanel plan={plan} events={[]} width={100} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Progress');
    expect(frame).toContain('50%');
  });

  it('does not count a failed task toward the Progress percentage', () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'done',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
          {
            id: 'TASK-002',
            title: 'Wire up the API',
            status: 'failed',
            dependsOn: [],
            file: 'task-2.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    const { lastFrame } = render(<ExecutionPanel plan={plan} events={[]} width={100} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Progress');
    expect(frame).toContain('50%');
    expect(frame).not.toContain('100%');
  });

  it('does not count an awaiting_human task toward the Progress percentage', () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'done',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
          {
            id: 'TASK-002',
            title: 'Wire up the API',
            status: 'awaiting_human',
            dependsOn: [],
            file: 'task-2.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    const { lastFrame } = render(<ExecutionPanel plan={plan} events={[]} width={100} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Progress');
    expect(frame).toContain('50%');
    expect(frame).not.toContain('100%');
  });

  it('shows an awaiting_human task-status entry in the Log module', () => {
    const events: ArchMeshEvent[] = [
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-001', status: 'awaiting_human' },
    ];
    const { lastFrame } = render(<ExecutionPanel plan={null} events={events} width={100} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TASK-001 needs your help');
  });

  it('reflects a worker activity event in the Agents module', () => {
    const events: ArchMeshEvent[] = [
      activity({ agentId: 'worker-1', role: 'worker', state: 'thinking' }),
    ];
    const { lastFrame } = render(<ExecutionPanel plan={null} events={events} width={100} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Worker 1:');
    expect(frame).toContain('Thinking…');
  });

  it('shows at most the 8 most recent log entries, oldest first and newest last', () => {
    const events: ArchMeshEvent[] = Array.from({ length: 10 }, (_, index) => ({
      type: 'task:status-changed',
      runId: 'run-1',
      taskId: `TASK-${String(index + 1).padStart(2, '0')}`,
      status: 'done',
    })) as ArchMeshEvent[];
    const { lastFrame } = render(<ExecutionPanel plan={null} events={events} width={100} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('TASK-01 completed');
    expect(frame).not.toContain('TASK-02 completed');
    const lines = frame.split('\n');
    const lineFor = (text: string) => lines.findIndex((line) => line.includes(text));
    expect(lineFor('TASK-03 completed')).toBeGreaterThan(-1);
    expect(lineFor('TASK-10 completed')).toBeGreaterThan(lineFor('TASK-03 completed'));
  });

  it('prefixes each log entry with its receipt time when timestamps are provided', () => {
    const events: ArchMeshEvent[] = [
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-001', status: 'done' },
    ];
    const { lastFrame } = render(
      <ExecutionPanel
        plan={null}
        events={events}
        eventTimestamps={[new Date(2026, 0, 1, 9, 5, 3).getTime()]}
        width={100}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('09:05:03 TASK-001 completed');
  });
});
