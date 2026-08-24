import type { ArchMeshEvent } from '@losina/ipc';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { AgentTranscript } from './agent-transcript.js';

const runId = 'run-1';
const agentId = 'worker-TASK-001';

describe('AgentTranscript', () => {
  it('shows a placeholder when the agent has no activity yet', () => {
    const { lastFrame } = render(
      <AgentTranscript events={[]} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    expect(lastFrame()).toContain('No activity yet for this agent.');
  });

  it('renders a dispatch marker for a thinking event, never the prompt text itself', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('sent prompt · TASK-001');
  });

  it('renders lifecycle events with their status text', () => {
    const events: ArchMeshEvent[] = [
      { type: 'agent:activity', runId, agentId, role: 'worker', state: 'spawning' },
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'using-tool',
        tool: 'Edit',
      },
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'completed',
        taskId: 'TASK-001',
      },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('starting…');
    expect(frame).toContain('using Edit');
    expect(frame).toContain('finished · TASK-001');
  });

  it('renders a failed lifecycle event', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'failed',
        taskId: 'TASK-001',
      },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    expect(lastFrame()).toContain('failed · TASK-001');
  });

  it("renders the model's own message text under the agent label, colored by role", () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:message',
        runId,
        agentId,
        role: 'worker',
        taskId: 'TASK-001',
        text: 'Implemented the login page as requested.',
      },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Worker 1');
    expect(frame).toContain('Implemented the login page as requested.');
  });

  it('includes task-status changes for tasks the agent has touched', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
      { type: 'task:status-changed', runId, taskId: 'TASK-001', status: 'done' },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    expect(lastFrame()).toContain('TASK-001 completed');
  });

  it('shows the failure reason under a failed task-status line, in the same error tone', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
      {
        type: 'task:status-changed',
        runId,
        taskId: 'TASK-001',
        status: 'failed',
        failureReason: 'Checks failed: lint reported 3 errors.',
      },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TASK-001 failed');
    expect(frame).toContain('Checks failed: lint reported 3 errors.');
  });

  it('says "continued" on a task\'s second in_progress transition for this agent', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
      { type: 'task:status-changed', runId, taskId: 'TASK-001', status: 'in_progress' },
      { type: 'task:status-changed', runId, taskId: 'TASK-001', status: 'needs_correction' },
      { type: 'task:status-changed', runId, taskId: 'TASK-001', status: 'in_progress' },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TASK-001 started');
    expect(frame).toContain('TASK-001 continued');
  });

  it('ignores task-status changes for tasks the agent never touched', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
      { type: 'task:status-changed', runId, taskId: 'TASK-999', status: 'done' },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    expect(lastFrame() ?? '').not.toContain('TASK-999');
  });

  it('renders an awaiting_human task-status change with its "needs your help" text', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
      { type: 'task:status-changed', runId, taskId: 'TASK-001', status: 'awaiting_human' },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    expect(lastFrame()).toContain('TASK-001 needs your help');
  });

  it('renders a delivered human prompt in its own bordered box', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'human:prompt-sent',
        runId,
        taskId: 'TASK-001',
        agentId,
        text: 'Try the v2 approach.',
      },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('You');
    expect(frame).toContain('(delivered)');
    expect(frame).toContain('Try the v2 approach.');
    expect(frame).toContain('╭');
  });

  it('flips a delivered human prompt to processing once the agent picks it up', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'human:prompt-sent',
        runId,
        taskId: 'TASK-001',
        agentId,
        text: 'Try the v2 approach.',
      },
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
        viaHumanPrompt: true,
      },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('(processing…)');
    expect(frame).not.toContain('(delivered)');
    expect(frame).not.toContain('sent prompt');
  });

  it("filters out events belonging to other agents' ids", () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId: 'tl-run-1',
        role: 'tl',
        state: 'thinking',
      },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId]} agentLabel="Worker 1" />,
    );
    expect(lastFrame()).toContain('No activity yet for this agent.');
  });

  it('aggregates entries from every agentId in the group, in chronological order — a reused slot shows its full task history', () => {
    const secondAgentId = 'worker-TASK-004';
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
      { type: 'task:status-changed', runId, taskId: 'TASK-001', status: 'done' },
      {
        type: 'agent:activity',
        runId,
        agentId: secondAgentId,
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-004',
      },
      { type: 'task:status-changed', runId, taskId: 'TASK-004', status: 'failed' },
    ];
    const { lastFrame } = render(
      <AgentTranscript events={events} agentIds={[agentId, secondAgentId]} agentLabel="Worker 1" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('sent prompt · TASK-001');
    expect(frame).toContain('TASK-001 completed');
    expect(frame).toContain('sent prompt · TASK-004');
    expect(frame).toContain('TASK-004 failed');
  });

  it('includes task-status changes for a taskId passed via the taskIds prop, even with no matching agent activity', () => {
    const events: ArchMeshEvent[] = [
      { type: 'task:status-changed', runId, taskId: 'TASK-001', status: 'failed' },
    ];
    const { lastFrame } = render(
      <AgentTranscript
        events={events}
        agentIds={[agentId]}
        taskIds={['TASK-001']}
        agentLabel="Worker 1"
      />,
    );
    expect(lastFrame()).toContain('TASK-001 failed');
  });

  it('shows a custom emptyMessage when provided', () => {
    const { lastFrame } = render(
      <AgentTranscript
        events={[]}
        agentIds={[agentId]}
        agentLabel="Worker 1"
        emptyMessage="No activity yet for this task."
      />,
    );
    expect(lastFrame()).toContain('No activity yet for this task.');
  });

  it('prefixes entries with a formatted time when timestamps are provided', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        state: 'thinking',
        taskId: 'TASK-001',
      },
    ];
    const timestamp = new Date(2026, 0, 1, 9, 5, 3).getTime();
    const { lastFrame } = render(
      <AgentTranscript
        events={events}
        eventTimestamps={[timestamp]}
        agentIds={[agentId]}
        agentLabel="Worker 1"
      />,
    );
    expect(lastFrame() ?? '').toContain('09:05:03');
  });
});
