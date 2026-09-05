import { consultStuckTask, reviewTask } from '@losina/architect';
import {
  type RunEventBus,
  loadConsultationRequest,
  loadReviewRequest,
  loadRunSessions,
  saveRunSessions,
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

  const loop = (async () => {
    const initialSessions = await loadRunSessions(runDir);
    let architectSessionId = initialSessions.architectSessionId;

    while (!stopped) {
      if (signal.aborted) return;

      const next = queue.shift();
      if (!next) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }

      if (next.kind === 'review') {
        try {
          const request = await loadReviewRequest(next.event.requestPath);

          bus.emit({
            type: 'agent:activity',
            runId,
            agentId: architectAgentId,
            role: 'architect',
            taskId: request.taskId,
            state: 'thinking',
          });

          const review = await reviewTask({
            run,
            taskId: request.taskId,
            taskMarkdown: request.taskMarkdown,
            correctionMarkdowns: request.correctionMarkdowns,
            gitDiff: request.gitDiff,
            model: request.model,
            correctionFilePath: request.correctionFilePath,
            workerSummary: request.workerSummary,
            resumeSessionId: architectSessionId,
            signal,
            onProgress: (progress) =>
              bus.emit(
                activityFromProgress(
                  {
                    runId,
                    agentId: architectAgentId,
                    role: 'architect',
                    taskId: request.taskId,
                  },
                  progress,
                ),
              ),
          });

          architectSessionId = review.sessionId;
          const latest = await loadRunSessions(runDir);
          await saveRunSessions(runDir, { ...latest, architectSessionId });

          bus.emit({
            type: 'agent:activity',
            runId,
            agentId: architectAgentId,
            role: 'architect',
            taskId: request.taskId,
            state: 'completed',
          });

          bus.emit({
            type: 'agent:message',
            runId,
            agentId: architectAgentId,
            role: 'architect',
            taskId: request.taskId,
            text: review.verdict.approved
              ? 'Approved — no corrections requested.'
              : review.verdict.correctionMarkdown,
          });

          const responsePath = await writeReviewResponse(runDir, {
            taskId: request.taskId,
            seq: next.event.seq,
            sessionId: review.sessionId,
            approved: review.verdict.approved,
            correctionMarkdown: review.verdict.approved
              ? undefined
              : review.verdict.correctionMarkdown,
          });

          bus.emit({
            type: 'review:completed',
            runId,
            taskId: request.taskId,
            seq: next.event.seq,
            responsePath,
            approved: review.verdict.approved,
          });
        } catch (error) {
          if (error instanceof RunAbortedError) return;
          console.error(
            `[daemon] architect loop failed to process review for ${next.event.taskId}:`,
            error,
          );
          bus.emit({
            type: 'agent:activity',
            runId,
            agentId: architectAgentId,
            role: 'architect',
            taskId: next.event.taskId,
            state: 'failed',
          });
        }
        continue;
      }

      // next.kind === 'consultation'
      try {
        const request = await loadConsultationRequest(next.event.requestPath);

        bus.emit({
          type: 'agent:activity',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          taskId: request.taskId,
          state: 'thinking',
        });

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
          resumeSessionId: architectSessionId,
          signal,
          onProgress: (progress) =>
            bus.emit(
              activityFromProgress(
                { runId, agentId: architectAgentId, role: 'architect', taskId: request.taskId },
                progress,
              ),
            ),
        });

        architectSessionId = result.sessionId;
        const latest = await loadRunSessions(runDir);
        await saveRunSessions(runDir, { ...latest, architectSessionId });

        bus.emit({
          type: 'agent:activity',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          taskId: request.taskId,
          state: 'completed',
        });

        if (result.question) {
          bus.emit({
            type: 'agent:message',
            runId,
            agentId: architectAgentId,
            role: 'architect',
            taskId: request.taskId,
            text: result.question,
          });
        }

        bus.emit({
          type: 'consultation:completed',
          runId,
          taskId: request.taskId,
          seq: next.event.seq,
          question: result.question,
          recommendation: result.recommendation,
        });
      } catch (error) {
        if (error instanceof RunAbortedError) return;
        console.error(
          `[daemon] architect loop failed to process consultation for ${next.event.taskId}:`,
          error,
        );
        bus.emit({
          type: 'agent:activity',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          taskId: next.event.taskId,
          state: 'failed',
        });
        // waitForConsultationOutcome never rejects — it needs this event even on failure so it
        // doesn't hang until its own timeout for what's already a known-failed consultation.
        bus.emit({
          type: 'consultation:completed',
          runId,
          taskId: next.event.taskId,
          seq: next.event.seq,
        });
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
