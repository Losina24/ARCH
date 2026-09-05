import { type RunEventBus, loadReviewResponse } from '@losina/core';
import type { ArchMeshEvent } from '@losina/ipc';
import { RunAbortedError } from './run-aborted-error.js';

export interface WaitForReviewOutcomeParams {
  bus: RunEventBus;
  runId: string;
  taskId: string;
  seq: number;
  signal: AbortSignal;
}

export interface ReviewOutcome {
  approved: boolean;
  correctionMarkdown?: string;
}

/**
 * Resolves once the architect loop publishes a matching review:completed event
 * for this exact (taskId, seq) pair, or rejects if the run aborts or the
 * architect fails while reviewing this task.
 */
export function waitForReviewOutcome(params: WaitForReviewOutcomeParams): Promise<ReviewOutcome> {
  const { bus, runId, taskId, seq, signal } = params;

  if (signal.aborted) return Promise.reject(new RunAbortedError(runId));

  return new Promise<ReviewOutcome>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      unsubscribe();
    };

    const onAbort = () => {
      cleanup();
      reject(new RunAbortedError(runId));
    };

    signal.addEventListener('abort', onAbort);

    const unsubscribe = bus.subscribe((event: ArchMeshEvent) => {
      if (event.runId !== runId) return;

      if (event.type === 'review:completed' && event.taskId === taskId && event.seq === seq) {
        cleanup();
        loadReviewResponse(event.responsePath)
          .then((response) =>
            resolve({
              approved: response.approved,
              correctionMarkdown: response.correctionMarkdown,
            }),
          )
          .catch(reject);
        return;
      }

      if (
        event.type === 'agent:activity' &&
        event.role === 'architect' &&
        event.taskId === taskId &&
        event.state === 'failed'
      ) {
        cleanup();
        reject(
          new Error(
            `Architect review failed for task ${taskId}: ${event.detail ?? 'no detail available'}`,
          ),
        );
      }
    });
  });
}
