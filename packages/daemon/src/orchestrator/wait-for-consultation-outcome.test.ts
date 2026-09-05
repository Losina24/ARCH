import { RunEventBus } from '@losina/core';
import { describe, expect, it } from 'vitest';
import { waitForConsultationOutcome } from './wait-for-consultation-outcome.js';

const runId = 'run-1';
const taskId = 'TASK-001';

describe('waitForConsultationOutcome', () => {
  it('resolves with the question and recommendation from a matching consultation:completed event', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();

    const promise = waitForConsultationOutcome({
      bus,
      runId,
      taskId,
      seq: 1,
      signal: controller.signal,
      timeoutMs: 5000,
    });
    bus.emit({
      type: 'consultation:completed',
      runId,
      taskId,
      seq: 1,
      question: 'Root or dist?',
      recommendation: 'Root.',
    });

    await expect(promise).resolves.toEqual({ question: 'Root or dist?', recommendation: 'Root.' });
  });

  it('resolves undefined (never rejects) when the event carries no question', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();

    const promise = waitForConsultationOutcome({
      bus,
      runId,
      taskId,
      seq: 1,
      signal: controller.signal,
      timeoutMs: 5000,
    });
    bus.emit({ type: 'consultation:completed', runId, taskId, seq: 1 });

    await expect(promise).resolves.toBeUndefined();
  });

  it('defaults a missing recommendation to an empty string rather than undefined', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();

    const promise = waitForConsultationOutcome({
      bus,
      runId,
      taskId,
      seq: 1,
      signal: controller.signal,
      timeoutMs: 5000,
    });
    bus.emit({ type: 'consultation:completed', runId, taskId, seq: 1, question: 'Root or dist?' });

    await expect(promise).resolves.toEqual({ question: 'Root or dist?', recommendation: '' });
  });

  it('ignores a consultation:completed event for a different task or seq', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();
    let settled = false;

    const promise = waitForConsultationOutcome({
      bus,
      runId,
      taskId,
      seq: 1,
      signal: controller.signal,
      timeoutMs: 5000,
    });
    promise.then(() => {
      settled = true;
    });
    bus.emit({
      type: 'consultation:completed',
      runId,
      taskId: 'TASK-999',
      seq: 1,
      question: 'unrelated',
      recommendation: 'unrelated',
    });
    bus.emit({
      type: 'consultation:completed',
      runId,
      taskId,
      seq: 2,
      question: 'wrong seq',
      recommendation: 'wrong seq',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    bus.emit({
      type: 'consultation:completed',
      runId,
      taskId,
      seq: 1,
      question: 'right one',
      recommendation: 'right one',
    });
    await expect(promise).resolves.toEqual({ question: 'right one', recommendation: 'right one' });
  });

  it('resolves undefined on abort instead of hanging or rejecting', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();

    const promise = waitForConsultationOutcome({
      bus,
      runId,
      taskId,
      seq: 1,
      signal: controller.signal,
      timeoutMs: 5000,
    });
    controller.abort();

    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves undefined immediately when already aborted before being called', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();
    controller.abort();

    const promise = waitForConsultationOutcome({
      bus,
      runId,
      taskId,
      seq: 1,
      signal: controller.signal,
      timeoutMs: 5000,
    });

    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves undefined once the timeout elapses, never leaving the caller hanging', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();

    const promise = waitForConsultationOutcome({
      bus,
      runId,
      taskId,
      seq: 1,
      signal: controller.signal,
      timeoutMs: 20,
    });

    await expect(promise).resolves.toBeUndefined();
  });

  it('ignores a late event that arrives after the timeout already resolved the promise', async () => {
    const bus = new RunEventBus();
    const controller = new AbortController();

    const promise = waitForConsultationOutcome({
      bus,
      runId,
      taskId,
      seq: 1,
      signal: controller.signal,
      timeoutMs: 20,
    });
    await expect(promise).resolves.toBeUndefined();

    // Must not throw (e.g. from resolving an already-settled promise a second time) and must not
    // affect anything — there's nothing left listening to assert against, this only proves the
    // late emit doesn't crash the process.
    expect(() =>
      bus.emit({
        type: 'consultation:completed',
        runId,
        taskId,
        seq: 1,
        question: 'too late',
        recommendation: 'too late',
      }),
    ).not.toThrow();
  });
});
