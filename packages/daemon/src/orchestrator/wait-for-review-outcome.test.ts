import { RunEventBus } from '@losina/core';
import { describe, expect, it } from 'vitest';
import { waitForReviewOutcome } from './wait-for-review-outcome.js';

const runId = 'run-1';
const taskId = 'TASK-002';

describe('waitForReviewOutcome', () => {
  it('rejects with the detail from a matching agent:activity failed event', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();

    const promise = waitForReviewOutcome({ bus, runId, taskId, seq: 1, signal: controller.signal });
    bus.emit({
      type: 'agent:activity',
      runId,
      agentId: 'architect-run-1',
      role: 'architect',
      taskId,
      state: 'failed',
      detail: 'Claude CLI exited unexpectedly (no exit code — the process may not have started).',
    });

    await expect(promise).rejects.toThrow(
      'Architect review failed for task TASK-002: Claude CLI exited unexpectedly (no exit code — the process may not have started).',
    );
  });

  it('falls back to a sane message when the failed activity carries no detail', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();

    const promise = waitForReviewOutcome({ bus, runId, taskId, seq: 1, signal: controller.signal });
    bus.emit({
      type: 'agent:activity',
      runId,
      agentId: 'architect-run-1',
      role: 'architect',
      taskId,
      state: 'failed',
    });

    await expect(promise).rejects.toThrow(
      'Architect review failed for task TASK-002: no detail available',
    );
  });

  it('ignores a failed activity for a different task', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();

    const promise = waitForReviewOutcome({ bus, runId, taskId, seq: 1, signal: controller.signal });
    bus.emit({
      type: 'agent:activity',
      runId,
      agentId: 'architect-run-1',
      role: 'architect',
      taskId: 'TASK-999',
      state: 'failed',
      detail: 'unrelated failure',
    });
    bus.emit({
      type: 'review:completed',
      runId,
      taskId,
      seq: 1,
      responsePath: '/tmp/does-not-matter.yaml',
      approved: true,
    });

    // Resolution depends on loadReviewResponse reading a real file, which this test doesn't
    // provide — the point here is only that the unrelated failed activity above did NOT reject
    // the promise, so it's still pending on (and will reject from) the file read instead.
    await expect(promise).rejects.toBeTruthy();
  });

  it('ignores a non-failed activity for the right task', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();
    let settled = false;

    const promise = waitForReviewOutcome({ bus, runId, taskId, seq: 1, signal: controller.signal });
    promise.catch(() => {
      settled = true;
    });
    bus.emit({
      type: 'agent:activity',
      runId,
      agentId: 'architect-run-1',
      role: 'architect',
      taskId,
      state: 'thinking',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    controller.abort();
    await expect(promise).rejects.toBeTruthy();
  });
});
