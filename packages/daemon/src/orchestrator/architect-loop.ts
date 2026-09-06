import { chatWithArchitect, consultStuckTask, reviewTask } from '@losina/architect';
import {
  architectAgentId as buildArchitectAgentId,
  type RunEventBus,
  loadConsultationRequest,
  loadReviewRequest,
  loadRunPlan,
  loadRunSessions,
  saveRunSessions,
  writeReviewResponse,
} from '@losina/core';
import type {
  ChatRequestedEvent,
  ConsultationRequestedEvent,
  ReviewRequestedEvent,
} from '@losina/ipc';
import type { AgentMeshConfig, RunMeta } from '@losina/schemas';
import type { RunManager } from '../run-manager.js';
import { activityFromProgress } from './agent-progress.js';
import { RunAbortedError } from './run-aborted-error.js';

export interface ArchitectLoopParams {
  run: RunMeta;
  runDir: string;
  config: AgentMeshConfig;
  bus: RunEventBus;
  signal: AbortSignal;
  /** Only needed for chat:requested's pendingChats bookkeeping — see RunManager.beginChat/endChat. */
  runManager: RunManager;
  /** Starts a brand-new ARCH run (same cwd) for a chat turn that asked for real project work —
   * see the 'chat' branch below and main.ts's own triggerChatPhase, which does the same thing on
   * its one-shot path. */
  createFollowUpRun: (prompt: string) => Promise<RunMeta>;
}

export interface ArchitectLoopHandle {
  stop: () => Promise<void>;
}

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

/**
 * A deterministic note appended after a chat turn that started a follow-up run, independent of
 * whatever the model itself said in its own reply — shared with main.ts's triggerChatPhase, the
 * one-shot path for the same feature, so the announcement reads identically either way.
 */
export function formatFollowUpRunAnnouncement(newRun: RunMeta): string {
  return `Started a new run for that: ${newRun.runId.slice(0, 8)} — "${newRun.title}". Check Home to follow it.`;
}

type ArchitectJob =
  | { kind: 'review'; event: ReviewRequestedEvent }
  | { kind: 'consultation'; event: ConsultationRequestedEvent }
  | { kind: 'chat'; event: ChatRequestedEvent };

/**
 * Sequentially drains review:requested, consultation:requested, and chat:requested events for
 * this run, resolving each into its matching completion (review/consultation emit their own
 * *:completed event; chat replies via a plain agent:message), keeping a single architect process
 * alive across every task review, consultation, AND chat turn in the run. Everything queues FIFO
 * — no priority-jumping a review or consultation in progress, including a chat message, since
 * none of them is blocking forward progress on other tasks.
 *
 * Review and consultation deliberately never resume a model session (see the comments on each
 * call below); chat is the one exception, keeping its own `chatSessionId` resumed on every turn
 * — see RunSessionsSchema.
 */
export function startArchitectLoop(params: ArchitectLoopParams): ArchitectLoopHandle {
  const { run, runDir, config, bus, signal, runManager, createFollowUpRun } = params;
  const runId = run.runId;
  const architectAgentId = buildArchitectAgentId(runId);

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
    } else if (event.type === 'chat:requested') {
      queue.push({ kind: 'chat', event });
      wake?.();
    }
  });

  const loop = (async () => {
    const initialSessions = await loadRunSessions(runDir);
    let chatSessionId = initialSessions.chatSessionId;

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
            dependencyScopes: request.dependencyScopes,
            // Deliberately never resumed — every review prompt already carries the task brief,
            // every prior correction, and the current diff, so a fresh session has everything a
            // resumed one would have, without a run-long conversation growing across every task's
            // reviews (and consultations too, see the consultStuckTask call below — chat below
            // that is the one exception, see this function's own doc comment).
            resumeSessionId: undefined,
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
            detail: summarizeActivityFailure(error),
          });
        }
        continue;
      }

      if (next.kind === 'consultation') {
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
            // Deliberately never resumed — see the matching comment on the Worker dispatch in
            // tl-loop.ts and on the review call above. The consultation prompt already carries the
            // task brief, every prior correction, the diff, and exactly why the deterministic rules
            // gave up, so a fresh session has everything a resumed one would have.
            resumeSessionId: undefined,
            signal,
            onProgress: (progress) =>
              bus.emit(
                activityFromProgress(
                  { runId, agentId: architectAgentId, role: 'architect', taskId: request.taskId },
                  progress,
                ),
              ),
          });

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
            detail: summarizeActivityFailure(error),
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
        continue;
      }

      // next.kind === 'chat'
      runManager.beginChat();
      try {
        bus.emit({
          type: 'agent:activity',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          state: 'thinking',
        });

        const plan = await loadRunPlan(runDir);
        const result = await chatWithArchitect({
          run,
          runDir,
          plan,
          message: next.event.message,
          model: config.models.architectModel,
          resumeSessionId: chatSessionId,
          signal,
          onProgress: (progress) =>
            bus.emit(
              activityFromProgress({ runId, agentId: architectAgentId, role: 'architect' }, progress),
            ),
        });

        chatSessionId = result.sessionId;
        const latest = await loadRunSessions(runDir);
        await saveRunSessions(runDir, { ...latest, chatSessionId });

        bus.emit({
          type: 'agent:activity',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          state: 'completed',
        });

        bus.emit({
          type: 'agent:message',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          text: result.reply,
        });

        if (result.runRequest) {
          const newRun = await createFollowUpRun(result.runRequest);
          bus.emit({
            type: 'agent:message',
            runId,
            agentId: architectAgentId,
            role: 'architect',
            text: formatFollowUpRunAnnouncement(newRun),
          });
        }
      } catch (error) {
        if (error instanceof RunAbortedError) return;
        console.error(`[daemon] architect loop failed to process chat message for run ${runId}:`, error);
        bus.emit({
          type: 'agent:activity',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          state: 'failed',
          detail: summarizeActivityFailure(error),
        });
        bus.emit({
          type: 'agent:message',
          runId,
          agentId: architectAgentId,
          role: 'architect',
          text: `Sorry, something went wrong answering that: ${summarizeActivityFailure(error)}`,
        });
      } finally {
        runManager.endChat();
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
