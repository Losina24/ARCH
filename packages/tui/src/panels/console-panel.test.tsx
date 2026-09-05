import type { ArchMeshEvent } from '@losina/ipc';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { ConsolePanel } from './console-panel.js';

const WIDTH = 80;
const panelProps = {
  width: WIDTH,
  height: 20,
  scrollOffset: 0,
  onScrollMetrics: () => undefined,
};

describe('ConsolePanel', () => {
  it('shows the Architect agent even with no activity yet', () => {
    const { lastFrame } = render(
      <ConsolePanel events={[]} selectedAgentId={null} {...panelProps} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Architect');
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
      <ConsolePanel events={events} selectedAgentId={null} {...panelProps} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Worker 1');
    expect(frame).toContain('Working on');
    expect(frame).toContain('TASK-001');
  });

  it('prompts to select an agent when none is selected', () => {
    const { lastFrame } = render(
      <ConsolePanel events={[]} selectedAgentId={null} {...panelProps} />,
    );
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
      <ConsolePanel events={events} selectedAgentId="worker-TASK-001" {...panelProps} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('❯ Worker 1');
  });

  it("shows only the selected agent's transcript in the main section", () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId: 'run-1',
        agentId: 'architect-run-1',
        role: 'architect',
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
        <ConsolePanel events={events} selectedAgentId="worker-TASK-001" {...panelProps} />,
      ).lastFrame() ?? '';
    expect(workerFrame).toContain('sent prompt · TASK-001');

    const architectFrame =
      render(
        <ConsolePanel events={events} selectedAgentId="architect-run-1" {...panelProps} />,
      ).lastFrame() ?? '';
    expect(architectFrame).not.toContain('sent prompt · TASK-001');
    expect(architectFrame).toContain('sent prompt');
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
      <ConsolePanel events={events} selectedAgentId="worker-TASK-001" {...panelProps} />,
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
      <ConsolePanel events={events} selectedAgentId="worker-TASK-001" {...panelProps} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Implemented the login page as requested.');
  });

  it('keeps the agent menu visible while only the selected transcript scrolls', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId: 'run-1',
        agentId: 'worker-TASK-001',
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
      ...Array.from(
        { length: 8 },
        (_, index): ArchMeshEvent => ({
          type: 'agent:message',
          runId: 'run-1',
          agentId: 'worker-TASK-001',
          role: 'worker',
          taskId: 'TASK-001',
          text: `message-${index}`,
        }),
      ),
    ];

    const { lastFrame } = render(
      <ConsolePanel
        {...panelProps}
        height={12}
        events={events}
        selectedAgentId="worker-TASK-001"
        scrollOffset={7}
      />,
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Architect');
    expect(frame).toContain('❯ Worker 1');
    expect(frame).not.toContain('message-0');
    expect(frame).toContain('message-7');
  });
});
