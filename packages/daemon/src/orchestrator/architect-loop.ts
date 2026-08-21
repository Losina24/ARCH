import { reviewTask } from '@arch/architect';
import {
  type RunEventBus,
  loadReviewRequest,
  loadRunSessions,
  saveRunSessions,
  writeReviewResponse,
} from '@arch/core';
import type { ReviewRequestedEvent } from '@arch/ipc';
import type { AgentMeshConfig, RunMeta } from '@arch/schemas';
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

/**
 * Sequentially drains review:requested events for this run and resolves each
 * one into a review:completed event, keeping a single architect session
 * alive across every task review in the run (mirrors the prior
 * architectMutex-serialized behavior, but as its own independent loop rather
 * than a lock shared with the TL's per-task cycles).
 */
export function startArchitectLoop(params: ArchitectLoopParams): ArchitectLoopHandle {
  const { run, runDir, config, bus, signal } = params;
  const runId = run.runId;
  const architectAgentId = `architect-${runId}`;

  const queue: ReviewRequestedEvent[] = [];
  let wake: (() => void) | undefined;
  let stopped = false;

  const unsubscribe = bus.subscribe((event) => {
    if (event.type === 'review:requested' && event.runId === runId) {
      queue.push(event);
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

      try {
        const request = await loadReviewRequest(next.requestPath);

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
          seq: next.seq,
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
          seq: next.seq,
          responsePath,
          approved: review.verdict.approved,
        });
      } catch (error) {
        if (error instanceof RunAbortedError) return;
        console.error(`[daemon] architect loop failed to process ${next.taskId}:`, error);
        bus.emit({
          type: 'agent:activity',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          taskId: next.taskId,
          state: 'failed',
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
