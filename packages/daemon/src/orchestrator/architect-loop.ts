import type { AgentProgressEvent } from '@losina/agent-runtime';
import { consultStuckTask, reviewTask } from '@losina/architect';
import {
  type RunEventBus,
  loadConsultationRequest,
  loadReviewRequest,
  writeReviewResponse,
} from '@losina/core';
import type { ConsultationRequestedEvent, ReviewRequestedEvent } from '@losina/ipc';
import type { AgentMeshConfig, RunMeta } from '@losina/schemas';
import { activityFromProgress } from './agent-progress.js';
import { RunAbortedError } from './run-aborted-error.js';

export interface ArchitectLoopParams {
  run: RunMeta;
  runDir: string;
  config: AgentMeshConfig;
  bus: RunEventBus;
  signal: AbortSignal;
}

export interface ArchitectLoopHandle {
  stop: () => Promise<void>;
}

type ArchitectJob =
  | { kind: 'review'; event: ReviewRequestedEvent }
  | { kind: 'consultation'; event: ConsultationRequestedEvent };

const ACTIVITY_FAILURE_DETAIL_MAX_CHARS = 500;

/**
 * Short, bounded summary of a caught error, carried on the `agent:activity {state:'failed'}`
 * event so `waitForReviewOutcome` (and ultimately a task's `failureReason`) can tell the human
 * what actually went wrong instead of a generic "Architect review failed for task X". The
 * runtimes' own error classes (`ClaudeCliExecutionError` and friends) already guarantee a short,
 * argv-free message for the failure modes they know about; the truncation here is a final safety
 * net for whatever else might be thrown, not the primary defense.
 */
export function summarizeActivityFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > ACTIVITY_FAILURE_DETAIL_MAX_CHARS
    ? `${message.slice(0, ACTIVITY_FAILURE_DETAIL_MAX_CHARS)}…`
    : message;
}

interface ArchitectJobContext {
  runId: string;
  bus: RunEventBus;
  architectAgentId: string;
}

/** Common shape every Architect call (review or consultation) resolves to. */
interface ArchitectJobResult {
  sessionId: string;
  /** Rendered as an `agent:message`, if present. */
  message?: string;
}

/**
 * Runs one Architect call (a review or a consultation) through the activity bookkeeping both
 * share: emitting `thinking`/`completed` activity around it, forwarding provider progress, and
 * surfacing `result.message` as an `agent:message`. `onSuccess` handles what's specific to the
 * job kind (writing the response file, emitting the matching `*:completed` event); `onFailure`
 * handles the kind-specific failure event(s), on top of the generic
 * `agent:activity {state:'failed'}` this always emits. Rethrows `RunAbortedError` unchanged so
 * the caller can stop the loop instead of logging it.
 */
async function runArchitectJob<TRequest, TResult extends ArchitectJobResult>(
  context: ArchitectJobContext,
  params: {
    taskId: string;
    requestPath: string;
    resumeSessionId: string | undefined;
    loadRequest: (path: string) => Promise<TRequest>;
    execute: (
      request: TRequest,
      resumeSessionId: string | undefined,
      onProgress: (progress: AgentProgressEvent) => void,
    ) => Promise<TResult>;
    onSuccess: (request: TRequest, result: TResult) => Promise<void>;
    onFailure: (error: unknown) => void;
  },
): Promise<void> {
  const { runId, bus, architectAgentId } = context;
  const { taskId, requestPath, resumeSessionId, loadRequest, execute, onSuccess, onFailure } =
    params;

  try {
    const request = await loadRequest(requestPath);

    bus.emit({
      type: 'agent:activity',
      runId,
      agentId: architectAgentId,
      role: 'architect',
      taskId,
      state: 'thinking',
    });

    const result = await execute(request, resumeSessionId, (progress) =>
      bus.emit(
        activityFromProgress({ runId, agentId: architectAgentId, role: 'architect', taskId }, progress),
      ),
    );

    bus.emit({
      type: 'agent:activity',
      runId,
      agentId: architectAgentId,
      role: 'architect',
      taskId,
      state: 'completed',
    });

    if (result.message) {
      bus.emit({
        type: 'agent:message',
        runId,
        agentId: architectAgentId,
        role: 'architect',
        taskId,
        text: result.message,
      });
    }

    await onSuccess(request, result);
  } catch (error) {
    if (error instanceof RunAbortedError) throw error;
    onFailure(error);
  }
}

/**
 * Sequentially drains review:requested and consultation:requested events for this run, resolving
 * each into its matching *:completed event, keeping a single architect session alive across every
 * task review AND consultation in the run. A consultation queues FIFO behind whatever's already
 * ahead of it — no priority-jumping a review in progress — since it's about a task that's already
 * being finalized either way, not something blocking forward progress on other tasks.
 */
export function startArchitectLoop(params: ArchitectLoopParams): ArchitectLoopHandle {
  const { run, runDir, config, bus, signal } = params;
  const runId = run.runId;
  const architectAgentId = `architect-${runId}`;
  const jobContext: ArchitectJobContext = { runId, bus, architectAgentId };

  const queue: ArchitectJob[] = [];
  let wake: (() => void) | undefined;
  let stopped = false;

  const unsubscribe = bus.subscribe((event) => {
    if (event.runId !== runId) return;
    if (event.type === 'review:requested') {
      queue.push({ kind: 'review', event });
      wake?.();
    } else if (event.type === 'consultation:requested') {
      queue.push({ kind: 'consultation', event });
      wake?.();
    }
  });

  const runReviewJob = (event: ReviewRequestedEvent) =>
    runArchitectJob(jobContext, {
      taskId: event.taskId,
      requestPath: event.requestPath,
      // Deliberately never resumed — every review prompt already carries the task brief, every
      // prior correction, and the current diff, so a fresh session has everything a resumed one
      // would have, without a run-long conversation growing across every task's reviews (and
      // consultations too, see runConsultationJob below).
      resumeSessionId: undefined,
      loadRequest: loadReviewRequest,
      execute: async (request, sessionId, onProgress) => {
        const review = await reviewTask({
          run,
          taskId: request.taskId,
          taskMarkdown: request.taskMarkdown,
          correctionMarkdowns: request.correctionMarkdowns,
          gitDiff: request.gitDiff,
          model: request.model,
          correctionFilePath: request.correctionFilePath,
          workerSummary: request.workerSummary,
          dependencyScopes: request.dependencyScopes,
          resumeSessionId: sessionId,
          signal,
          onProgress,
        });
        return {
          sessionId: review.sessionId,
          message: review.verdict.approved
            ? 'Approved — no corrections requested.'
            : review.verdict.correctionMarkdown,
          review,
        };
      },
      onSuccess: async (request, { review }) => {
        const responsePath = await writeReviewResponse(runDir, {
          taskId: request.taskId,
          seq: event.seq,
          sessionId: review.sessionId,
          approved: review.verdict.approved,
          correctionMarkdown: review.verdict.approved ? undefined : review.verdict.correctionMarkdown,
        });

        bus.emit({
          type: 'review:completed',
          runId,
          taskId: request.taskId,
          seq: event.seq,
          responsePath,
          approved: review.verdict.approved,
        });
      },
      onFailure: (error) => {
        console.error(`[daemon] architect loop failed to process review for ${event.taskId}:`, error);
        bus.emit({
          type: 'agent:activity',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          taskId: event.taskId,
          state: 'failed',
          detail: summarizeActivityFailure(error),
        });
      },
    });

  const runConsultationJob = (event: ConsultationRequestedEvent) =>
    runArchitectJob(jobContext, {
      taskId: event.taskId,
      requestPath: event.requestPath,
      // Deliberately never resumed — see the matching comment on runReviewJob above and on the
      // Worker dispatch in tl-loop.ts. The consultation prompt already carries the task brief,
      // every prior correction, the diff, and exactly why the deterministic rules gave up, so a
      // fresh session has everything a resumed one would have.
      resumeSessionId: undefined,
      loadRequest: loadConsultationRequest,
      execute: async (request, sessionId, onProgress) => {
        const result = await consultStuckTask({
          run,
          taskId: request.taskId,
          taskMarkdown: request.taskMarkdown,
          correctionMarkdowns: request.correctionMarkdowns,
          gitDiff: request.gitDiff,
          workerSummary: request.workerSummary,
          failureReason: request.failureReason,
          failureKind: request.failureKind,
          retriesSpent: request.retriesSpent,
          maxRetries: request.maxRetries,
          model: request.model,
          consultationFilePath: request.consultationFilePath,
          resumeSessionId: sessionId,
          signal,
          onProgress,
        });
        return {
          sessionId: result.sessionId,
          message: result.question,
          question: result.question,
          recommendation: result.recommendation,
        };
      },
      onSuccess: async (request, { question, recommendation }) => {
        bus.emit({
          type: 'consultation:completed',
          runId,
          taskId: request.taskId,
          seq: event.seq,
          question,
          recommendation,
        });
      },
      onFailure: (error) => {
        console.error(
          `[daemon] architect loop failed to process consultation for ${event.taskId}:`,
          error,
        );
        bus.emit({
          type: 'agent:activity',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          taskId: event.taskId,
          state: 'failed',
          detail: summarizeActivityFailure(error),
        });
        // waitForConsultationOutcome never rejects — it needs this event even on failure so it
        // doesn't hang until its own timeout for what's already a known-failed consultation.
        bus.emit({
          type: 'consultation:completed',
          runId,
          taskId: event.taskId,
          seq: event.seq,
        });
      },
    });

  const loop = (async () => {
    while (!stopped) {
      if (signal.aborted) return;

      const next = queue.shift();
      if (!next) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }

      try {
        if (next.kind === 'review') {
          await runReviewJob(next.event);
        } else {
          await runConsultationJob(next.event);
        }
      } catch (error) {
        if (error instanceof RunAbortedError) return;
        throw error;
      }
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      wake?.();
      unsubscribe();
      await loop;
    },
  };
}
