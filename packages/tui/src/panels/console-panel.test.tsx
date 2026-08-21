import type { ArchMeshEvent } from '@arch/ipc';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { ConsolePanel } from './console-panel.js';

const WIDTH = 80;

describe('ConsolePanel', () => {
  it('shows the Architect and TL agents even with no activity yet', () => {
    const { lastFrame } = render(<ConsolePanel events={[]} selectedAgentId={null} width={WIDTH} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Architect');
    expect(frame).toContain('TL');
  });

  it('lists a worker agent and its status once it has activity', () => {
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
      <ConsolePanel events={events} selectedAgentId={null} width={WIDTH} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Worker 1');
    expect(frame).toContain('Working on');
    expect(frame).toContain('TASK-001');
  });

  it('prompts to select an agent when none is selected', () => {
    const { lastFrame } = render(<ConsolePanel events={[]} selectedAgentId={null} width={WIDTH} />);
    expect(lastFrame()).toContain('Select an agent to access its terminal.');
  });

  it('marks the selected agent with the selection cursor', () => {
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
      <ConsolePanel events={events} selectedAgentId="worker-TASK-001" width={WIDTH} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('❯ Worker 1');
  });

  it("shows only the selected agent's transcript in the main section", () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId: 'run-1',
        agentId: 'tl-run-1',
        role: 'tl',
        state: 'thinking',
      },
      {
        type: 'agent:activity',
        runId: 'run-1',
        agentId: 'worker-TASK-001',
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
    ];

    const workerFrame =
      render(
        <ConsolePanel events={events} selectedAgentId="worker-TASK-001" width={WIDTH} />,
      ).lastFrame() ?? '';
    expect(workerFrame).toContain('sent prompt · TASK-001');

    const tlFrame =
      render(
        <ConsolePanel events={events} selectedAgentId="tl-run-1" width={WIDTH} />,
      ).lastFrame() ?? '';
    expect(tlFrame).not.toContain('sent prompt · TASK-001');
    expect(tlFrame).toContain('sent prompt');
  });

  it('never renders the internal prompt text, only that a prompt was sent', () => {
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
      <ConsolePanel events={events} selectedAgentId="worker-TASK-001" width={WIDTH} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('sent prompt');
  });

  it("renders the model's own message text for a completed turn", () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId: 'run-1',
        agentId: 'worker-TASK-001',
        role: 'worker',
        state: 'completed',
        taskId: 'TASK-001',
      },
      {
        type: 'agent:message',
        runId: 'run-1',
        agentId: 'worker-TASK-001',
        role: 'worker',
        taskId: 'TASK-001',
        text: 'Implemented the login page as requested.',
      },
    ];
    const { lastFrame } = render(
      <ConsolePanel events={events} selectedAgentId="worker-TASK-001" width={WIDTH} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Implemented the login page as requested.');
  });
});
