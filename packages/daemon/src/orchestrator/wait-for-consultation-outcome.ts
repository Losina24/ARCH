import type { RunEventBus } from '@losina/core';
import type { ArchMeshEvent } from '@losina/ipc';

export interface WaitForConsultationOutcomeParams {
  bus: RunEventBus;
  runId: string;
  taskId: string;
  seq: number;
  signal: AbortSignal;
  /** Safety net so a hung Architect call can never block a task from finalizing. */
  timeoutMs: number;
}

export interface ConsultationOutcome {
  question: string;
  recommendation: string;
}

/**
 * Resolves once the architect loop publishes a matching consultation:completed event for this
 * exact (taskId, seq) pair. Unlike waitForReviewOutcome, this NEVER rejects — on abort, timeout,
 * or the Architect failing to produce a question, it resolves `undefined`. A consultation is
 * best-effort commentary on a task that's already being finalized; it must never be able to turn
 * into a reason the task's own finalization fails or hangs.
 */
export function waitForConsultationOutcome(
  params: WaitForConsultationOutcomeParams,
): Promise<ConsultationOutcome | undefined> {
  const { bus, runId, taskId, seq, signal, timeoutMs } = params;

  if (signal.aborted) return Promise.resolve(undefined);

  return new Promise<ConsultationOutcome | undefined>((resolve) => {
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      unsubscribe();
    };

    const finish = (value: ConsultationOutcome | undefined) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onAbort = () => finish(undefined);
    signal.addEventListener('abort', onAbort);
    const timer = setTimeout(() => finish(undefined), timeoutMs);

    const unsubscribe = bus.subscribe((event: ArchMeshEvent) => {
      if (event.runId !== runId) return;
      if (event.type !== 'consultation:completed') return;
      if (event.taskId !== taskId || event.seq !== seq) return;

      finish(
        event.question !== undefined
          ? { question: event.question, recommendation: event.recommendation ?? '' }
          : undefined,
      );
    });
  });
}
