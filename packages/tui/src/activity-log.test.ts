import type { ArchMeshEvent } from '@losina/ipc';
import { describe, expect, it } from 'vitest';
import { buildActivityLog, taskStatusLogText, taskStatusLogTone } from './activity-log.js';

const runId = 'run-1';

describe('buildActivityLog', () => {
  it('ignores agent:message events entirely, not falling through to the run-status fallback', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:message',
        runId,
        agentId: 'worker-1',
        role: 'worker',
        taskId: 'TASK-1',
        text: 'Implemented the feature.',
      },
    ];

    expect(buildActivityLog(events)).toEqual([]);
  });

  it('ignores human:prompt-sent events entirely, not falling through to the run-status fallback', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'human:prompt-sent',
        runId,
        taskId: 'TASK-1',
        agentId: 'worker-TASK-1',
        text: 'Try the v2 approach.',
      },
    ];

    expect(buildActivityLog(events)).toEqual([]);
  });

  it('maps task status transitions to human-readable entries', () => {
    const events: ArchMeshEvent[] = [
      { type: 'task:status-changed', runId, taskId: 'TASK-1', status: 'in_progress' },
      { type: 'task:status-changed', runId, taskId: 'TASK-1', status: 'in_review' },
      { type: 'task:status-changed', runId, taskId: 'TASK-1', status: 'needs_correction' },
      { type: 'task:status-changed', runId, taskId: 'TASK-1', status: 'done' },
      { type: 'task:status-changed', runId, taskId: 'TASK-2', status: 'failed' },
      { type: 'task:status-changed', runId, taskId: 'TASK-3', status: 'awaiting_human' },
    ];

    expect(buildActivityLog(events)).toEqual([
      { id: '0', text: 'TASK-1 started', tone: 'info' },
      { id: '1', text: 'TASK-1 sent for review', tone: 'warning' },
      { id: '2', text: 'TASK-1 needs correction', tone: 'error' },
      { id: '3', text: 'TASK-1 completed', tone: 'success' },
      { id: '4', text: 'TASK-2 failed', tone: 'error' },
      { id: '5', text: 'TASK-3 needs your help', tone: 'waiting' },
    ]);
  });

  it('says a task "continued" on its second in_progress transition, not "started" again', () => {
    const events: ArchMeshEvent[] = [
      { type: 'task:status-changed', runId, taskId: 'TASK-1', status: 'in_progress' },
      { type: 'task:status-changed', runId, taskId: 'TASK-1', status: 'needs_correction' },
      { type: 'task:status-changed', runId, taskId: 'TASK-1', status: 'in_progress' },
    ];

    expect(buildActivityLog(events)).toEqual([
      { id: '0', text: 'TASK-1 started', tone: 'info' },
      { id: '1', text: 'TASK-1 needs correction', tone: 'error' },
      { id: '2', text: 'TASK-1 continued', tone: 'info' },
    ]);
  });

  it('ignores task statuses that are not meaningful lifecycle moments', () => {
    const events: ArchMeshEvent[] = [
      { type: 'task:status-changed', runId, taskId: 'TASK-1', status: 'pending' },
      { type: 'task:status-changed', runId, taskId: 'TASK-1', status: 'ready' },
      { type: 'task:status-changed', runId, taskId: 'TASK-1', status: 'blocked' },
    ];

    expect(buildActivityLog(events)).toEqual([]);
  });

  it('does not infer review starts from architect thinking updates', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId: 'architect-1',
        role: 'architect',
        taskId: 'TASK-1',
        state: 'thinking',
      },
      {
        type: 'agent:activity',
        runId,
        agentId: 'architect-1',
        role: 'architect',
        taskId: 'TASK-1',
        state: 'thinking',
        detail: 'Analyzing results',
      },
    ];

    expect(buildActivityLog(events)).toEqual([]);
  });

  it('reports an architect failure with no task as a planning failure', () => {
    const events: ArchMeshEvent[] = [
      { type: 'agent:activity', runId, agentId: 'architect-1', role: 'architect', state: 'failed' },
    ];

    expect(buildActivityLog(events)).toEqual([
      { id: '0', text: 'Architect failed during planning', tone: 'error' },
    ]);
  });

  it('ignores agent:activity events that are not review-start or planning-failure moments', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'agent:activity',
        runId,
        agentId: 'worker-1',
        role: 'worker',
        taskId: 'TASK-1',
        state: 'thinking',
      },
      {
        type: 'agent:activity',
        runId,
        agentId: 'worker-1',
        role: 'worker',
        taskId: 'TASK-1',
        state: 'failed',
      },
    ];

    expect(buildActivityLog(events)).toEqual([]);
  });

  it('reports exactly one review start from its dedicated request event', () => {
    const events: ArchMeshEvent[] = [
      { type: 'review:requested', runId, taskId: 'TASK-1', seq: 1, requestPath: '/tmp/req.yaml' },
      {
        type: 'agent:activity',
        runId,
        agentId: 'architect-1',
        role: 'architect',
        taskId: 'TASK-1',
        state: 'thinking',
      },
      {
        type: 'agent:activity',
        runId,
        agentId: 'architect-1',
        role: 'architect',
        taskId: 'TASK-1',
        state: 'thinking',
        detail: 'Analyzing results',
      },
    ];

    expect(buildActivityLog(events)).toEqual([
      { id: '0', text: 'Review started on TASK-1', tone: 'warning' },
    ]);
  });

  it('reports a completed review as approved or with corrections', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'review:completed',
        runId,
        taskId: 'TASK-1',
        seq: 1,
        responsePath: '/tmp/res-1.yaml',
        approved: true,
      },
      {
        type: 'review:completed',
        runId,
        taskId: 'TASK-1',
        seq: 2,
        responsePath: '/tmp/res-2.yaml',
        approved: false,
      },
    ];

    expect(buildActivityLog(events)).toEqual([
      { id: '0', text: 'Review approved for TASK-1', tone: 'success' },
      { id: '1', text: 'Review sent corrections for TASK-1', tone: 'warning' },
    ]);
  });

  it('ignores the internal consultation request/response round-trip entirely', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'consultation:requested',
        runId,
        taskId: 'TASK-1',
        seq: 1,
        requestPath: '/tmp/consultation-req.yaml',
      },
      {
        type: 'consultation:completed',
        runId,
        taskId: 'TASK-1',
        seq: 1,
        question: 'Root or dist?',
        recommendation: 'Root.',
      },
    ];

    expect(buildActivityLog(events)).toEqual([]);
  });

  it('reports a human-facing consultation question', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'consultation:question-asked',
        runId,
        taskId: 'TASK-1',
        seq: 1,
        question: 'Root or dist?',
        recommendation: 'Root.',
        failureReason: 'Automated checks kept failing.',
      },
    ];

    expect(buildActivityLog(events)).toEqual([
      { id: '0', text: 'Architect needs your input on TASK-1', tone: 'waiting' },
    ]);
  });

  it('reports a consultation reply or dismissal', () => {
    const events: ArchMeshEvent[] = [
      {
        type: 'consultation:answered',
        runId,
        taskId: 'TASK-1',
        seq: 1,
        answer: 'Use root.',
        skipped: false,
      },
      { type: 'consultation:answered', runId, taskId: 'TASK-2', seq: 1, skipped: true },
    ];

    expect(buildActivityLog(events)).toEqual([
      { id: '0', text: 'Replied to the Architect about TASK-1', tone: 'info' },
      { id: '1', text: "Dismissed the Architect's question on TASK-2", tone: 'info' },
    ]);
  });

  it('maps run status changes to a phase entry', () => {
    const events: ArchMeshEvent[] = [
      { type: 'run:status-changed', runId, phase: 'implementation' },
    ];

    expect(buildActivityLog(events)).toEqual([
      { id: '0', text: 'Run moved to implementation', tone: 'info' },
    ]);
  });

  it('prefixes each entry with its formatted time when timestamps are provided', () => {
    const events: ArchMeshEvent[] = [
      { type: 'run:status-changed', runId, phase: 'implementation' },
    ];
    const timestamp = new Date(2026, 0, 1, 9, 5, 3).getTime();

    expect(buildActivityLog(events, [timestamp])).toEqual([
      { id: '0', text: '09:05:03 Run moved to implementation', tone: 'info' },
    ]);
  });
});

describe('taskStatusLogText', () => {
  it('formats a meaningful task status transition', () => {
    expect(taskStatusLogText('done', 'TASK-1')).toBe('TASK-1 completed');
  });

  it('returns undefined for a status with no lifecycle-log text', () => {
    expect(taskStatusLogText('pending', 'TASK-1')).toBeUndefined();
  });

  it('says "continued" instead of "started" when isResume is true', () => {
    expect(taskStatusLogText('in_progress', 'TASK-1', true)).toBe('TASK-1 continued');
  });

  it('says "started" by default when isResume is omitted', () => {
    expect(taskStatusLogText('in_progress', 'TASK-1')).toBe('TASK-1 started');
  });
});

describe('taskStatusLogTone', () => {
  it('returns the tone for a mapped status', () => {
    expect(taskStatusLogTone('failed')).toBe('error');
  });

  it('falls back to info for a status with no mapped tone', () => {
    expect(taskStatusLogTone('pending')).toBe('info');
  });
});
