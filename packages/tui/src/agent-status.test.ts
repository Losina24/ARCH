import type { AgentActivityEvent, ArchMeshEvent } from '@losina/ipc';
import { describe, expect, it } from 'vitest';
import {
  agentRoleColor,
  buildAgentLabels,
  deriveAgentStatuses,
  latestAssignedAgent,
  workerSlotGroup,
} from './agent-status.js';
import { neonGradientColor } from './neon-gradient.js';

function event(overrides: Partial<AgentActivityEvent>): AgentActivityEvent {
  return {
    type: 'agent:activity',
    runId: 'run-1',
    agentId: 'architect-1',
    role: 'architect',
    state: 'idle-waiting',
    ...overrides,
  } as AgentActivityEvent;
}

describe('deriveAgentStatuses', () => {
  it('always shows the Architect and TL, even with no events at all', () => {
    const entries = deriveAgentStatuses([]);
    expect(entries.map((entry) => entry.label)).toEqual(['Architect', 'TL']);
    expect(entries[0].statusText).toBe('Waiting');
    expect(entries[0].category).toBe('idle');
  });

  it('numbers distinct workers in first-appearance order', () => {
    const entries = deriveAgentStatuses([
      event({ agentId: 'worker-2', role: 'worker', state: 'thinking' }),
      event({ agentId: 'worker-1', role: 'worker', state: 'thinking' }),
    ]);
    const workers = entries.filter((entry) => entry.role === 'worker');
    expect(workers.map((entry) => entry.label)).toEqual(['Worker 1', 'Worker 2']);
    expect(workers[0].agentId).toBe('worker-2');
    expect(workers[1].agentId).toBe('worker-1');
  });

  it('categorizes idle-waiting and completed as idle', () => {
    const idleWaiting = deriveAgentStatuses([event({ state: 'idle-waiting' })])[0];
    const completed = deriveAgentStatuses([event({ state: 'completed' })])[0];
    expect(idleWaiting.category).toBe('idle');
    expect(completed.category).toBe('idle');
  });

  it('categorizes thinking and using-tool as working', () => {
    const thinking = deriveAgentStatuses([event({ state: 'thinking' })])[0];
    const usingTool = deriveAgentStatuses([event({ state: 'using-tool' })])[0];
    expect(thinking.category).toBe('working');
    expect(usingTool.category).toBe('working');
  });

  it('categorizes failed as blocked', () => {
    const entry = deriveAgentStatuses([event({ state: 'failed' })])[0];
    expect(entry.category).toBe('blocked');
  });

  it('categorizes a worker paused on awaiting_human as waiting, not idle — it is not available for new work', () => {
    const entries = deriveAgentStatuses([
      event({
        agentId: 'worker-TASK-001',
        role: 'worker',
        state: 'idle-waiting',
        taskId: 'TASK-001',
      }),
    ]);
    const worker = entries.find((entry) => entry.role === 'worker');
    expect(worker?.category).toBe('waiting');
    expect(worker?.statusText).toBe('Needs your help · TASK-001');
  });

  it("keeps the TL's genuine idle-waiting (no taskId) categorized as idle", () => {
    const tl = deriveAgentStatuses([
      event({ agentId: 'tl-run-1', role: 'tl', state: 'idle-waiting' }),
    ]).find((entry) => entry.role === 'tl');
    expect(tl?.category).toBe('idle');
    expect(tl?.statusText).toBe('Waiting');
  });

  it('shows the assigned task id while thinking or using a tool on it', () => {
    const entry = deriveAgentStatuses([event({ state: 'thinking', taskId: 'TASK-001' })])[0];
    expect(entry.statusText).toBe('Reviewing TASK-001');
  });

  it('prefers detailed live activity, file, and task over the generic role status', () => {
    const entry = deriveAgentStatuses([
      event({
        agentId: 'worker-TASK-001',
        role: 'worker',
        state: 'using-tool',
        detail: 'Running tests',
        tool: 'Shell',
        file: 'src/auth.ts',
        taskId: 'TASK-001',
      }),
    ]).find((candidate) => candidate.role === 'worker');

    expect(entry?.statusText).toBe('Running tests · src/auth.ts · TASK-001');
    expect(entry?.category).toBe('working');
  });

  it('uses only the latest event per agent', () => {
    const entries = deriveAgentStatuses([
      event({ state: 'thinking' }),
      event({ state: 'completed' }),
    ]);
    expect(entries[0].statusText).toBe('Idle');
  });

  it('reuses a freed slot once its task reaches a terminal status, instead of growing forever', () => {
    const events: ArchMeshEvent[] = [
      event({ agentId: 'worker-TASK-001', role: 'worker', state: 'thinking', taskId: 'TASK-001' }),
      event({ agentId: 'worker-TASK-002', role: 'worker', state: 'thinking', taskId: 'TASK-002' }),
      event({ agentId: 'worker-TASK-003', role: 'worker', state: 'thinking', taskId: 'TASK-003' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-002', status: 'done' },
      event({ agentId: 'worker-TASK-004', role: 'worker', state: 'thinking', taskId: 'TASK-004' }),
    ];
    const workers = deriveAgentStatuses(events).filter((entry) => entry.role === 'worker');
    expect(workers.map((entry) => entry.label)).toEqual(['Worker 1', 'Worker 2', 'Worker 3']);
    const slot2 = workers.find((entry) => entry.label === 'Worker 2');
    expect(slot2?.agentId).toBe('worker-TASK-004');
  });

  it('never exceeds the number of currently live worker slots, even after many tasks have completed', () => {
    const events: ArchMeshEvent[] = [
      event({ agentId: 'worker-TASK-001', role: 'worker', state: 'thinking', taskId: 'TASK-001' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-001', status: 'done' },
      event({ agentId: 'worker-TASK-002', role: 'worker', state: 'thinking', taskId: 'TASK-002' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-002', status: 'failed' },
      event({ agentId: 'worker-TASK-003', role: 'worker', state: 'thinking', taskId: 'TASK-003' }),
    ];
    const workers = deriveAgentStatuses(events).filter((entry) => entry.role === 'worker');
    expect(workers).toHaveLength(1);
    expect(workers[0].label).toBe('Worker 1');
    expect(workers[0].agentId).toBe('worker-TASK-003');
  });

  it('does not allocate the same freed slot to concurrent workers after repeated failures', () => {
    const events: ArchMeshEvent[] = [
      event({ agentId: 'worker-TASK-002', role: 'worker', state: 'thinking', taskId: 'TASK-002' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-002', status: 'failed' },
      event({ agentId: 'worker-TASK-002', role: 'worker', state: 'failed', taskId: 'TASK-002' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-002', status: 'pending' },
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-002', status: 'failed' },
      event({ agentId: 'worker-TASK-002', role: 'worker', state: 'failed', taskId: 'TASK-002' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-002', status: 'done' },
      event({ agentId: 'worker-TASK-003', role: 'worker', state: 'thinking', taskId: 'TASK-003' }),
      event({ agentId: 'worker-TASK-004', role: 'worker', state: 'thinking', taskId: 'TASK-004' }),
      event({ agentId: 'worker-TASK-007', role: 'worker', state: 'thinking', taskId: 'TASK-007' }),
    ];

    const workers = deriveAgentStatuses(events).filter((entry) => entry.role === 'worker');
    expect(workers.map(({ agentId, label }) => [agentId, label])).toEqual([
      ['worker-TASK-003', 'Worker 1'],
      ['worker-TASK-004', 'Worker 2'],
      ['worker-TASK-007', 'Worker 3'],
    ]);
  });

  it('marks a failed worker slot occupied again when that task resumes', () => {
    const events: ArchMeshEvent[] = [
      event({ agentId: 'worker-TASK-001', role: 'worker', state: 'thinking', taskId: 'TASK-001' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-001', status: 'failed' },
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-001', status: 'in_progress' },
      event({ agentId: 'worker-TASK-001', role: 'worker', state: 'thinking', taskId: 'TASK-001' }),
      event({ agentId: 'worker-TASK-002', role: 'worker', state: 'thinking', taskId: 'TASK-002' }),
    ];

    const workers = deriveAgentStatuses(events).filter((entry) => entry.role === 'worker');
    expect(workers.map(({ agentId, label }) => [agentId, label])).toEqual([
      ['worker-TASK-001', 'Worker 1'],
      ['worker-TASK-002', 'Worker 2'],
    ]);
  });

  it('moves a resumed worker to another slot if its previous one has already been reused', () => {
    const events: ArchMeshEvent[] = [
      event({ agentId: 'worker-TASK-001', role: 'worker', state: 'thinking', taskId: 'TASK-001' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-001', status: 'failed' },
      event({ agentId: 'worker-TASK-002', role: 'worker', state: 'thinking', taskId: 'TASK-002' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-001', status: 'in_progress' },
      event({ agentId: 'worker-TASK-001', role: 'worker', state: 'thinking', taskId: 'TASK-001' }),
    ];

    const workers = deriveAgentStatuses(events).filter((entry) => entry.role === 'worker');
    expect(workers.map(({ agentId, label }) => [agentId, label])).toEqual([
      ['worker-TASK-002', 'Worker 1'],
      ['worker-TASK-001', 'Worker 2'],
    ]);
  });
});

describe('buildAgentLabels', () => {
  it('maps agentId to role labels, numbering workers by first appearance', () => {
    const labels = buildAgentLabels([
      event({ agentId: 'architect-1', role: 'architect' }),
      event({ agentId: 'worker-a', role: 'worker' }),
      event({ agentId: 'worker-b', role: 'worker' }),
    ]);
    expect(labels.get('architect-1')).toBe('Architect');
    expect(labels.get('worker-a')).toBe('Worker 1');
    expect(labels.get('worker-b')).toBe('Worker 2');
  });

  it('keeps a permanent label for a completed task even after its slot is reused by a later task', () => {
    const events: ArchMeshEvent[] = [
      event({ agentId: 'worker-TASK-001', role: 'worker', state: 'thinking', taskId: 'TASK-001' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-001', status: 'done' },
      event({ agentId: 'worker-TASK-004', role: 'worker', state: 'thinking', taskId: 'TASK-004' }),
    ];
    const labels = buildAgentLabels(events);
    expect(labels.get('worker-TASK-001')).toBe('Worker 1');
    expect(labels.get('worker-TASK-004')).toBe('Worker 1');
  });
});

describe('workerSlotGroup', () => {
  it('groups every agentId that has ever occupied the same slot, in first-appearance order', () => {
    const events: ArchMeshEvent[] = [
      event({ agentId: 'worker-TASK-001', role: 'worker', state: 'thinking', taskId: 'TASK-001' }),
      { type: 'task:status-changed', runId: 'run-1', taskId: 'TASK-001', status: 'done' },
      event({ agentId: 'worker-TASK-004', role: 'worker', state: 'thinking', taskId: 'TASK-004' }),
    ];
    expect(workerSlotGroup(events, 'worker-TASK-004')).toEqual([
      'worker-TASK-001',
      'worker-TASK-004',
    ]);
    expect(workerSlotGroup(events, 'worker-TASK-001')).toEqual([
      'worker-TASK-001',
      'worker-TASK-004',
    ]);
  });

  it('returns just the agentId itself for an agent that never appeared', () => {
    expect(workerSlotGroup([], 'architect-1')).toEqual(['architect-1']);
  });

  it('does not group two live, distinct worker slots together', () => {
    const events: ArchMeshEvent[] = [
      event({ agentId: 'worker-TASK-001', role: 'worker', state: 'thinking', taskId: 'TASK-001' }),
      event({ agentId: 'worker-TASK-002', role: 'worker', state: 'thinking', taskId: 'TASK-002' }),
    ];
    expect(workerSlotGroup(events, 'worker-TASK-001')).toEqual(['worker-TASK-001']);
  });
});

describe('agentRoleColor', () => {
  it('places architect, tl, and worker at t=0, t=0.5, and t=1 of the neon gradient', () => {
    expect(agentRoleColor('architect')).toBe(neonGradientColor(0));
    expect(agentRoleColor('tl')).toBe(neonGradientColor(0.5));
    expect(agentRoleColor('worker')).toBe(neonGradientColor(1));
  });

  it('gives every role a distinct color, matching the Overview models list scheme', () => {
    const colors = new Set(
      (['architect', 'tl', 'worker'] as const).map((role) => agentRoleColor(role)),
    );
    expect(colors.size).toBe(3);
  });
});

describe('latestAssignedAgent', () => {
  it('returns undefined when no event references the task', () => {
    expect(latestAssignedAgent([], 'TASK-001')).toBeUndefined();
  });

  it('returns the most recent agent assigned to the task', () => {
    const events = [
      event({ agentId: 'worker-1', taskId: 'TASK-001' }),
      event({ agentId: 'worker-2', taskId: 'TASK-001' }),
    ];
    expect(latestAssignedAgent(events, 'TASK-001')).toBe('worker-2');
  });
});
