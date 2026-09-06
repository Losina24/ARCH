import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  RunEventBus,
  getReadyTaskIds,
  loadTasksIndex,
  saveTasksIndex,
  selectDispatchableTaskIds,
} from '@losina/core';
import type { AgentMeshConfig, RunMeta, Task } from '@losina/schemas';
import type { RunManager } from '../run-manager.js';
import type { DaemonServerHandle } from '../server.js';
import { startArchitectLoop } from './architect-loop.js';
import { cascadeBlockDependentTasks } from './cascade-block.js';
import { Mutex } from './mutex.js';
import { getRunDir, persistRunMeta } from './persist.js';
import { RunAbortedError } from './run-aborted-error.js';
import { runTlTaskCycle } from './tl-loop.js';

export interface ImplementationPhaseParams {
  runId: string;
  archDir: string;
  config: AgentMeshConfig;
  runManager: RunManager;
  handle: DaemonServerHandle;
  signal: AbortSignal;
  /** When retrying a single previously failed task, its id and the human's note for the worker. */
  retryTaskId?: string;
  retryMessage?: string;
  /** Forwarded to startArchitectLoop — see ArchitectLoopParams.createFollowUpRun. */
  createFollowUpRun: (prompt: string) => Promise<RunMeta>;
}

const POLL_INTERVAL_MS = 1000;

export async function runImplementationPhase(params: ImplementationPhaseParams): Promise<void> {
  const {
    runId,
    archDir,
    config,
    runManager,
    handle,
    signal,
    retryTaskId,
    retryMessage,
    createFollowUpRun,
  } = params;
  const run = runManager.get(runId);
  if (!run) return;

  const runDir = getRunDir(archDir, runId);
  const tasksIndexPath = join(runDir, 'tasks-index.yaml');
  const worktreesDir = join(runDir, 'worktrees');
  const tasksIndex = await loadTasksIndex(tasksIndexPath);
  const gitMutex = new Mutex();
  const inFlight = new Map<string, Promise<void>>();
  const inFlightTasks = new Map<string, Task>();
  const humanMessages = new Map<string, string>();
  if (retryTaskId && retryMessage !== undefined) {
    humanMessages.set(retryTaskId, retryMessage);
  }

  // Internal pub/sub between the task cycles and the Architect loop, in addition to the
  // socket broadcast to TUI clients: every event that reaches the bus is
  // also forwarded to connected clients, so cycle/Architect coordination and
  // UI visibility stay driven by the same single stream.
  const bus = new RunEventBus();
  // Registered so run.chat can reach this loop's bus while it's alive (see RunManager.getEventBus)
  // instead of going through the one-shot triggerChatPhase path meant for phases with no live
  // Architect — cleared in the finally block below alongside architectLoop.stop().
  runManager.setEventBus(runId, bus);
  const unsubscribeForwarding = bus.subscribe((event) => handle.broadcast(event));
  // Recorded here (rather than read back off the persisted event log) so retryTask can look up
  // the right seq synchronously when a human's reply arrives — see RunManager.pendingConsultations.
  const unsubscribeConsultations = bus.subscribe((event) => {
    if (event.type === 'consultation:question-asked' && event.runId === runId) {
      runManager.setPendingConsultation(runId, event.taskId, event.seq);
    }
  });
  const architectLoop = startArchitectLoop({
    run,
    runDir,
    config,
    bus,
    signal,
    runManager,
    createFollowUpRun,
  });

  // Applies a retry queued via RunManager.queueRetry (a task individually stuck while its
  // siblings are still in flight) directly to this loop's own in-memory tasks-index. Mutating a
  // second, freshly-disk-loaded copy from outside would race with this loop's own periodic
  // saveTasksIndex calls and could silently clobber or resurrect the wrong state.
  const applyQueuedRetries = async (): Promise<void> => {
    const queued = runManager.drainRetries(runId);
    if (queued.length === 0) return;

    const changedIds = new Set<string>();
    for (const { taskId, message } of queued) {
      const target = tasksIndex.tasks.find((task) => task.id === taskId);
      if (!target || (target.status !== 'failed' && target.status !== 'awaiting_human')) continue;

      await Promise.all(
        target.correctionFiles.map((file) => rm(join(runDir, file), { force: true })),
      );
      target.status = 'pending';
      target.retries = 0;
      target.correctionFiles = [];
      target.failureReason = undefined;
      changedIds.add(target.id);
      if (message !== undefined) humanMessages.set(taskId, message);

      // Any other task blocked only because it transitively depended on this one is safe to
      // free here too — cascadeBlockDependentTasks only ever blocks a pending task on a
      // failed/blocked/awaiting_human ancestor, never on one that's merely still in progress.
      for (const sibling of tasksIndex.tasks) {
        if (sibling.id !== target.id && sibling.status === 'blocked') {
          sibling.status = 'pending';
          changedIds.add(sibling.id);
        }
      }
    }

    if (changedIds.size === 0) return;
    await saveTasksIndex(tasksIndexPath, tasksIndex);
    for (const taskId of changedIds) {
      bus.emit({ type: 'task:status-changed', runId, taskId, status: 'pending' });
    }
  };

  try {
    while (true) {
      if (signal.aborted) throw new RunAbortedError(runId);

      await applyQueuedRetries();

      const cascaded = cascadeBlockDependentTasks(tasksIndex.tasks);
      if (cascaded.length > 0) {
        await saveTasksIndex(tasksIndexPath, tasksIndex);
        for (const taskId of cascaded) {
          bus.emit({ type: 'task:status-changed', runId, taskId, status: 'blocked' });
        }
      }

      const readyIds = getReadyTaskIds(tasksIndex.tasks).filter((id) => !inFlight.has(id));
      const dispatchableIds = selectDispatchableTaskIds(
        readyIds,
        tasksIndex.tasks,
        [...inFlightTasks.values()],
        config.execution.maxConcurrency,
        config.execution.useWorktrees,
      );
      for (const taskId of dispatchableIds) {
        const task = tasksIndex.tasks.find((candidate) => candidate.id === taskId);
        if (!task) continue;

        task.status = 'ready';
        await saveTasksIndex(tasksIndexPath, tasksIndex);
        bus.emit({ type: 'task:status-changed', runId, taskId, status: 'ready' });

        inFlightTasks.set(taskId, task);
        const cycle = runTlTaskCycle({
          run,
          task,
          tasksIndex,
          tasksIndexPath,
          runDir,
          worktreesDir,
          config,
          bus,
          gitMutex,
          signal,
          humanMessage: humanMessages.get(taskId),
        }).finally(() => {
          inFlight.delete(taskId);
          inFlightTasks.delete(taskId);
        });
        inFlight.set(taskId, cycle);
      }

      const allTerminal = tasksIndex.tasks.every(
        (task) =>
          task.status === 'done' ||
          task.status === 'failed' ||
          task.status === 'blocked' ||
          task.status === 'awaiting_human',
      );
      if (allTerminal && inFlight.size === 0) break;

      if (inFlight.size > 0) {
        await Promise.race([...inFlight.values(), delay(POLL_INTERVAL_MS)]);
      } else {
        await delay(POLL_INTERVAL_MS);
      }
    }

    const hasFailedTasks = tasksIndex.tasks.some(
      (task) => task.status === 'failed' || task.status === 'awaiting_human',
    );
    const finalPhase = hasFailedTasks ? 'blocked' : 'done';
    const updated = runManager.update(runId, { phase: finalPhase });
    runManager.clearAbortController(runId);
    await persistRunMeta(archDir, updated);
    handle.broadcast({ type: 'run:status-changed', runId, phase: finalPhase });
  } catch (error) {
    if (error instanceof RunAbortedError) {
      await Promise.allSettled([...inFlight.values()]);
      return;
    }
    // Anything else (e.g. a per-task crash whose own cleanup itself throws) must not leave the
    // RunManager believing this run's loop is still alive: retryTask() and run.abort both decide
    // what to do next purely from getAbortController(runId), and a message queued via
    // queueRetry() while that's true is only ever drained back at the top of this same loop — if
    // the loop is dead but the controller lingers, the message (and the "queued" success the
    // caller sees) is silently lost forever. Clear it and mark the run actionable before
    // rethrowing so the failure is still logged by the caller.
    runManager.clearAbortController(runId);
    const updated = runManager.update(runId, { phase: 'blocked' });
    await persistRunMeta(archDir, updated);
    handle.broadcast({ type: 'run:status-changed', runId, phase: 'blocked' });
    throw error;
  } finally {
    await architectLoop.stop();
    runManager.clearEventBus(runId);
    unsubscribeForwarding();
    unsubscribeConsultations();
  }
}
