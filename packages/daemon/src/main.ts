import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { chatWithArchitect } from '@losina/architect';
import { getArchPaths, loadConfig, saveConfig } from '@losina/config';
import {
  architectAgentId,
  loadRunPlan,
  loadRunSessions,
  loadTasksIndex,
  saveRunSessions,
  saveTasksIndex,
  workerAgentId,
} from '@losina/core';
import type {
  ArchMeshEvent,
  ConfigSetRequest,
  RunAbortRequest,
  RunAnswerGrillingQuestionRequest,
  RunApproveRequest,
  RunChatRequest,
  RunCreateRequest,
  RunDeleteRequest,
  RunDismissConsultationRequest,
  RunGetEventsRequest,
  RunGetPlanRequest,
  RunGetRequest,
  RunGetTaskFileRequest,
  RunRefineRequest,
  RunRetryTaskRequest,
} from '@losina/ipc';
import type { AgentMeshConfig, RunMeta, RunPlan } from '@losina/schemas';
import { runDefinitionPhase } from './orchestrator/definition-phase.js';
import { runGrillingPhase } from './orchestrator/grilling-phase.js';
import { runImplementationPhase } from './orchestrator/implementation-phase.js';
import {
  appendRunEvent,
  getRunDir,
  loadPersistedRuns,
  loadRunEvents,
  persistRunMeta,
  removeRunDir,
} from './orchestrator/persist.js';
import { RunManager } from './run-manager.js';
import { type DaemonServerHandle, startDaemonServer } from './server.js';

async function createRun(
  runManager: RunManager,
  archDir: string,
  payload: RunCreateRequest,
): Promise<RunMeta> {
  const now = new Date().toISOString();
  const title = payload.prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
  const run: RunMeta = {
    runId: randomUUID(),
    title,
    prompt: payload.prompt,
    cwd: payload.cwd,
    phase: 'grilling',
    createdAt: now,
    updatedAt: now,
  };
  runManager.register(run);
  await persistRunMeta(archDir, run);
  return run;
}

async function getRunPlan(archDir: string, runId: string): Promise<RunPlan | null> {
  return loadRunPlan(getRunDir(archDir, runId));
}

async function getTaskFile(archDir: string, runId: string, file: string): Promise<string | null> {
  const runDir = getRunDir(archDir, runId);
  const resolvedRunDir = resolve(runDir);
  const filePath = resolve(join(runDir, file));
  if (filePath !== resolvedRunDir && !filePath.startsWith(resolvedRunDir + sep)) {
    throw new Error(`Invalid task file path: ${file}`);
  }
  try {
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function retryTask(
  archDir: string,
  runManager: RunManager,
  handle: DaemonServerHandle,
  runId: string,
  taskId: string,
  message?: string,
): Promise<RunMeta> {
  const run = runManager.get(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  // A specific task can be individually stuck ('failed'/'awaiting_human') while its siblings
  // are still running — run.phase only leaves 'implementation' once every task is terminal, so
  // it stays 'implementation' the whole time. What actually matters for "is there anything to
  // retry" is the target task's own status, checked below; the run itself only rules out
  // 'definition' (no plan approved yet, so no task could have run) and 'done' (no failed task
  // is possible there).
  if (run.phase !== 'blocked' && run.phase !== 'implementation') {
    throw new Error(`Run ${runId} is not in progress — nothing to retry`);
  }

  const runDir = getRunDir(archDir, runId);
  const tasksIndexPath = join(runDir, 'tasks-index.yaml');
  const tasksIndex = await loadTasksIndex(tasksIndexPath);
  const target = tasksIndex.tasks.find((task) => task.id === taskId);
  if (!target) throw new Error(`Task not found: ${taskId}`);
  if (target.status !== 'failed' && target.status !== 'awaiting_human') {
    throw new Error(`Task ${taskId} is not failed — nothing to retry`);
  }

  // A human resolving this task via retryTask also answers any consultation question the
  // Architect asked about it — the reply is this same message, relayed verbatim (see
  // escalateToHuman in tl-loop.ts). No-op when there was no pending question.
  const pendingConsultationSeq = runManager.takePendingConsultation(runId, taskId);
  if (pendingConsultationSeq !== undefined) {
    handle.broadcast({
      type: 'consultation:answered',
      runId,
      taskId: target.id,
      seq: pendingConsultationSeq,
      answer: message,
      skipped: false,
    });
  }

  // Delete the physical correction files before forgetting them: a later attempt recomputes
  // correction filenames from `correctionFiles.length`, so a stale file left over from this
  // reset would collide with that recomputed path and get mistaken for a fresh rejection.
  await Promise.all(target.correctionFiles.map((file) => rm(join(runDir, file), { force: true })));

  // The implementation loop for this run is still live (a sibling task is still in flight, or
  // this task's own dependents kept it going) and holds the tasks-index in memory. Mutating a
  // second, freshly disk-loaded copy from here would race with that loop's own periodic
  // saveTasksIndex calls, so hand the retry to the loop instead and let it apply it on its own
  // in-memory state on the next tick.
  if (runManager.getAbortController(runId)) {
    runManager.queueRetry(runId, taskId, message);
    if (message !== undefined) {
      handle.broadcast({
        type: 'human:prompt-sent',
        runId,
        taskId: target.id,
        agentId: workerAgentId(target.id),
        text: message,
      });
    }
    return run;
  }

  target.status = 'pending';
  target.retries = 0;
  target.correctionFiles = [];
  target.failureReason = undefined;

  // Every other blocked task is reset to pending alongside the retried one: a task genuinely
  // still blocked by another still-failed dependency gets re-blocked automatically on the next
  // implementation-phase loop tick (cascadeBlockDependentTasks), so this is always safe.
  for (const task of tasksIndex.tasks) {
    if (task.id !== target.id && task.status === 'blocked') {
      task.status = 'pending';
    }
  }

  await saveTasksIndex(tasksIndexPath, tasksIndex);
  for (const task of tasksIndex.tasks) {
    if (task.id === target.id || task.status === 'pending') {
      handle.broadcast({ type: 'task:status-changed', runId, taskId: task.id, status: 'pending' });
    }
  }

  if (message !== undefined) {
    handle.broadcast({
      type: 'human:prompt-sent',
      runId,
      taskId: target.id,
      agentId: workerAgentId(target.id),
      text: message,
    });
  }

  const updated = runManager.update(runId, { phase: 'implementation' });
  await persistRunMeta(archDir, updated);
  handle.broadcast({ type: 'run:status-changed', runId, phase: 'implementation' });

  return updated;
}

async function updateConfig(cwd: string, patch: ConfigSetRequest): Promise<AgentMeshConfig> {
  const current = await loadConfig(cwd);
  const updated: AgentMeshConfig = {
    models: { ...current.models, ...patch.models },
    execution: {
      maxConcurrency: patch.maxConcurrency ?? current.execution.maxConcurrency,
      maxRetries: patch.maxRetries ?? current.execution.maxRetries,
      useWorktrees: patch.useWorktrees ?? current.execution.useWorktrees,
    },
  };
  await saveConfig(cwd, updated);
  return updated;
}

export async function startDaemon(cwd: string): Promise<DaemonServerHandle> {
  const { socketPath, archDir } = getArchPaths(cwd);
  await mkdir(archDir, { recursive: true });

  const runManager = new RunManager();
  // Repopulate from disk so runs created by a previous daemon process (before
  // a restart) stay reachable via run.get/run.getPlan/etc. Runs that were mid
  // "implementation" phase never get their execution loop resumed here — the
  // TL/architect loops backing that run are gone along with the old process,
  // and restarting them automatically would need to re-validate worktree
  // state first. A run stuck at phase 'implementation' with no in-process
  // AbortController is therefore orphaned by definition (the only way to
  // reach that phase in a live process is run.approve, which always sets a
  // controller) — flip it to 'blocked' immediately so it's visible/actionable
  // instead of silently frozen forever, and so hasActiveWork()/phase checks
  // elsewhere (e.g. the TUI's shutdown-on-quit guard) stay accurate.
  for (const run of await loadPersistedRuns(archDir)) {
    if (run.phase === 'implementation') {
      const blocked: RunMeta = { ...run, phase: 'blocked' };
      await persistRunMeta(archDir, blocked);
      runManager.register(blocked);
    } else {
      runManager.register(run);
    }
  }

  // `handle` is only available once startDaemonServer resolves, but the request handler
  // (built below) needs to broadcast through it before that happens. This stable wrapper
  // breaks the circularity: it can be captured immediately and forwards once `handleRef.current`
  // is assigned right after startDaemonServer returns.
  const handleRef: { current?: DaemonServerHandle } = {};
  let isClosing = false;

  // Serialized per run so concurrent appendRunEvent calls for the same run can't interleave their
  // writes — appendFile is atomic per call, but awaiting each broadcast before the next starts
  // would slow down delivery to live subscribers, so the write is queued instead.
  const eventWriteQueues = new Map<string, Promise<void>>();
  function enqueueEventWrite(event: ArchMeshEvent, timestamp: number) {
    const previous = eventWriteQueues.get(event.runId) ?? Promise.resolve();
    const next = previous
      .then(() => appendRunEvent(archDir, event, timestamp))
      .catch((error) => {
        console.error(`[daemon] failed to persist event for run ${event.runId}:`, error);
      });
    eventWriteQueues.set(event.runId, next);
  }

  // triggerDefinitionPhase/triggerImplementationPhase (below) are fire-and-forget from the RPC
  // handlers that start them, so callers aren't blocked on a whole run's orchestration — but
  // that means they can still be calling broadcast() well after the RPC that kicked them off
  // has returned. Tracking them lets close() wait out any still-running phase before it
  // declares no more event writes will be enqueued (see close() below).
  const activePhasePromises = new Set<Promise<void>>();
  function trackPhase(promise: Promise<void>): void {
    activePhasePromises.add(promise);
    void promise.finally(() => activePhasePromises.delete(promise));
  }

  const handle: DaemonServerHandle = {
    broadcast: (event: ArchMeshEvent) => {
      enqueueEventWrite(event, Date.now());
      handleRef.current?.broadcast(event);
    },
    close: async () => {
      isClosing = true;
      // Otherwise a shutdown scheduled while this instance was still alive (e.g. the last
      // client disconnected right before this call) fires its process.exit(0) after close()
      // has already resolved — killing whatever else is running in this process by then.
      cancelIdleShutdown();
      await handleRef.current?.close();
      // The socket is closed above, so no new run.create/run.approve/run.retryTask can start a
      // phase from here on — draining the currently-tracked phases once is enough to guarantee
      // none of them will call broadcast() again.
      await Promise.all(activePhasePromises);
      // Event writes are enqueued fire-and-forget from broadcast() so they never slow down live
      // delivery — but a caller that removes the archDir right after close() resolves (every
      // test fixture's cleanup does this) would otherwise race an in-flight mkdir/appendFile for
      // a run's event log against that rm -rf (ENOTEMPTY/ENOENT). All broadcasting is done by
      // this point (the phases above have finished), so draining the write queue once is enough.
      await Promise.all(eventWriteQueues.values());
    },
  };

  // Nothing else stops this process once every client is gone (there's no
  // supervisor watching it) — without this, a TUI/CLI that dies without a
  // clean /quit (crash, force-quit, SIGKILL) leaves the daemon running
  // forever with nothing left to do. Debounced so the brief connect/disconnect
  // from ensureDaemon's aliveness probe, or a client reconnecting quickly,
  // doesn't trigger a shutdown mid-handoff.
  const IDLE_SHUTDOWN_GRACE_MS = 10_000;
  let clientCount = 0;
  let idleShutdownTimer: NodeJS.Timeout | undefined;

  const cancelIdleShutdown = () => {
    if (idleShutdownTimer) {
      clearTimeout(idleShutdownTimer);
      idleShutdownTimer = undefined;
    }
  };

  const maybeScheduleIdleShutdown = () => {
    cancelIdleShutdown();
    // Closing the server itself closes its sockets, which reports a late zero-client count.
    // Never let that teardown notification schedule process.exit() after an explicit close.
    if (isClosing || clientCount > 0 || runManager.hasActiveWork()) return;
    idleShutdownTimer = setTimeout(() => {
      if (clientCount === 0 && !runManager.hasActiveWork()) {
        void handle.close().finally(() => process.exit(0));
      }
    }, IDLE_SHUTDOWN_GRACE_MS);
  };

  const triggerDefinitionPhase = (runId: string, feedback?: string) => {
    trackPhase(
      loadConfig(cwd)
        .then((config) =>
          runDefinitionPhase({ runId, archDir, config, runManager, handle, feedback }),
        )
        .catch((error) => {
          console.error(`[daemon] definition phase failed for run ${runId}:`, error);
        }),
    );
  };

  const triggerGrillingPhase = (runId: string, answer?: { text: string } | { skipped: true }) => {
    trackPhase(
      loadConfig(cwd)
        .then((config) =>
          runGrillingPhase({
            runId,
            archDir,
            config,
            runManager,
            handle,
            answer,
            triggerDefinitionPhase,
          }),
        )
        .catch((error) => {
          console.error(`[daemon] grilling phase failed for run ${runId}:`, error);
        }),
    );
  };

  // One-shot path for run.chat when no Architect loop is alive for this run (any phase other
  // than 'implementation' — see the run.chat case below for the live-bus path used there
  // instead). Calqued on triggerDefinitionPhase/triggerGrillingPhase, but there is no phase
  // object to hand off to: this calls chatWithArchitect directly and broadcasts its own result.
  const triggerChatPhase = (runId: string, message: string) => {
    trackPhase(
      (async () => {
        const run = runManager.get(runId);
        if (!run) return;
        const runDir = getRunDir(archDir, runId);
        const id = architectAgentId(runId);

        runManager.beginChat();
        try {
          const config = await loadConfig(cwd);
          const [plan, sessions] = await Promise.all([loadRunPlan(runDir), loadRunSessions(runDir)]);

          handle.broadcast({ type: 'agent:activity', runId, agentId: id, role: 'architect', state: 'thinking' });

          const result = await chatWithArchitect({
            run,
            plan,
            message,
            model: config.models.architectModel,
            resumeSessionId: sessions.chatSessionId,
          });

          await saveRunSessions(runDir, { ...sessions, chatSessionId: result.sessionId });

          handle.broadcast({ type: 'agent:activity', runId, agentId: id, role: 'architect', state: 'completed' });
          handle.broadcast({
            type: 'agent:message',
            runId,
            agentId: id,
            role: 'architect',
            text: result.reply,
          });
        } catch (error) {
          console.error(`[daemon] chat failed for run ${runId}:`, error);
          handle.broadcast({
            type: 'agent:activity',
            runId,
            agentId: id,
            role: 'architect',
            state: 'failed',
          });
          handle.broadcast({
            type: 'agent:message',
            runId,
            agentId: id,
            role: 'architect',
            text: `Sorry, something went wrong answering that: ${error instanceof Error ? error.message : String(error)}`,
          });
        } finally {
          runManager.endChat();
          maybeScheduleIdleShutdown();
        }
      })(),
    );
  };

  const triggerImplementationPhase = (
    runId: string,
    signal: AbortSignal,
    retry?: { retryTaskId: string; retryMessage: string },
  ) => {
    trackPhase(
      loadConfig(cwd)
        .then((config) =>
          runImplementationPhase({
            runId,
            archDir,
            config,
            runManager,
            handle,
            signal,
            retryTaskId: retry?.retryTaskId,
            retryMessage: retry?.retryMessage,
          }),
        )
        .catch((error) => {
          console.error(`[daemon] implementation phase failed for run ${runId}:`, error);
        })
        .finally(() => maybeScheduleIdleShutdown()),
    );
  };

  handleRef.current = await startDaemonServer(
    socketPath,
    async (method, payload) => {
      switch (method) {
        case 'run.create': {
          const run = await createRun(runManager, archDir, payload as RunCreateRequest);
          triggerGrillingPhase(run.runId);
          return run;
        }
        case 'run.list':
          return runManager.list();
        case 'run.get': {
          const { runId } = payload as RunGetRequest;
          const run = runManager.get(runId);
          if (!run) throw new Error(`Run not found: ${runId}`);
          return run;
        }
        case 'run.getPlan': {
          const { runId } = payload as RunGetPlanRequest;
          if (!runManager.get(runId)) throw new Error(`Run not found: ${runId}`);
          return getRunPlan(archDir, runId);
        }
        case 'run.getTaskFile': {
          const { runId, file } = payload as RunGetTaskFileRequest;
          if (!runManager.get(runId)) throw new Error(`Run not found: ${runId}`);
          return getTaskFile(archDir, runId, file);
        }
        case 'run.getEvents': {
          const { runId } = payload as RunGetEventsRequest;
          if (!runManager.get(runId)) throw new Error(`Run not found: ${runId}`);
          return loadRunEvents(archDir, runId);
        }
        case 'run.answerGrillingQuestion': {
          const { runId, answer, skip } = payload as RunAnswerGrillingQuestionRequest;
          const run = runManager.get(runId);
          if (!run) throw new Error(`Run not found: ${runId}`);
          if (run.phase !== 'grilling') {
            throw new Error(`Run ${runId} is not in the grilling phase`);
          }
          handle.broadcast({
            type: 'grilling:answered',
            runId,
            seq: (await loadRunSessions(getRunDir(archDir, runId))).grillingSeq,
            answer: skip ? undefined : answer,
            skipped: Boolean(skip),
          });
          triggerGrillingPhase(runId, skip ? { skipped: true } : { text: answer ?? '' });
          return run;
        }
        case 'run.dismissConsultation': {
          const { runId, taskId } = payload as RunDismissConsultationRequest;
          const run = runManager.get(runId);
          if (!run) throw new Error(`Run not found: ${runId}`);
          const seq = runManager.takePendingConsultation(runId, taskId);
          if (seq !== undefined) {
            handle.broadcast({
              type: 'consultation:answered',
              runId,
              taskId,
              seq,
              skipped: true,
            });
          }
          // No task-status mutation — dismissing only clears the question. The task stays
          // failed/awaiting_human, still retryable later via run.retryTask.
          return run;
        }
        case 'run.refine': {
          const { runId, feedback } = payload as RunRefineRequest;
          const run = runManager.get(runId);
          if (!run) throw new Error(`Run not found: ${runId}`);
          if (run.phase !== 'definition') {
            throw new Error(`Run ${runId} is not in the definition phase`);
          }
          triggerDefinitionPhase(runId, feedback);
          return run;
        }
        case 'run.chat': {
          const { runId, message } = payload as RunChatRequest;
          const run = runManager.get(runId);
          if (!run) throw new Error(`Run not found: ${runId}`);

          handle.broadcast({
            type: 'human:prompt-sent',
            runId,
            agentId: architectAgentId(runId),
            text: message,
          });

          // While the Architect's own loop is alive (implementation phase), hand the message to
          // it directly — same session continuity, same FIFO queue as review/consultation —
          // instead of the one-shot path below, which is for every other phase.
          const bus = runManager.getEventBus(runId);
          if (bus) {
            bus.emit({ type: 'chat:requested', runId, message });
          } else {
            triggerChatPhase(runId, message);
          }
          return run;
        }
        case 'run.approve': {
          const { runId } = payload as RunApproveRequest;
          const run = runManager.get(runId);
          if (!run) throw new Error(`Run not found: ${runId}`);
          if (run.phase !== 'definition') {
            throw new Error(`Run ${runId} is not in the definition phase`);
          }
          const plan = await getRunPlan(archDir, runId);
          if (!plan) throw new Error(`Run ${runId} has no plan ready yet`);

          const updated = runManager.update(runId, { phase: 'implementation' });
          await persistRunMeta(archDir, updated);
          handle.broadcast({ type: 'run:status-changed', runId, phase: 'implementation' });

          const controller = new AbortController();
          runManager.setAbortController(runId, controller);
          triggerImplementationPhase(runId, controller.signal);

          return updated;
        }
        case 'run.retryTask': {
          const { runId, taskId, message } = payload as RunRetryTaskRequest;
          // Capture this before retryTask() runs: when a loop is already live for this run,
          // retryTask() only queues the retry for that loop to pick up — starting a second
          // loop here too would race both against each other over the same tasks-index.
          const loopAlreadyRunning = runManager.getAbortController(runId) !== undefined;
          const updated = await retryTask(archDir, runManager, handle, runId, taskId, message);
          if (!loopAlreadyRunning) {
            const controller = new AbortController();
            runManager.setAbortController(runId, controller);
            triggerImplementationPhase(runId, controller.signal, {
              retryTaskId: taskId,
              retryMessage: message,
            });
          }
          return updated;
        }
        case 'run.abort': {
          const { runId } = payload as RunAbortRequest;
          const run = runManager.get(runId);
          if (!run) throw new Error(`Run not found: ${runId}`);
          const controller = runManager.getAbortController(runId);
          if (!controller) throw new Error(`Run ${runId} has no active work to abort`);
          controller.abort();
          runManager.clearAbortController(runId);
          maybeScheduleIdleShutdown();
          return run;
        }
        case 'run.delete': {
          const { runId } = payload as RunDeleteRequest;
          const run = runManager.get(runId);
          if (!run) throw new Error(`Run not found: ${runId}`);
          // Phase alone isn't a reliable "active" signal: a run whose implementation
          // loop was running before a daemon restart stays stuck at phase
          // 'implementation' forever (loadPersistedRuns doesn't resume it, see above),
          // with no AbortController either — so an abort-controller-only check is what
          // run.abort already uses, and it's the only way to avoid deadlocking deletion
          // for orphaned runs like that.
          if (runManager.getAbortController(runId)) {
            throw new Error(`Run ${runId} is still active — abort it before deleting`);
          }
          await removeRunDir(archDir, runId);
          runManager.unregister(runId);
          return { ok: true };
        }
        case 'config.get':
          return loadConfig(cwd);
        case 'config.set':
          return updateConfig(cwd, payload as ConfigSetRequest);
        case 'daemon.shutdown': {
          // Deferred so the { ok: true } response is flushed to the client's
          // socket before the process disappears out from under it.
          setImmediate(() => process.exit(0));
          return { ok: true };
        }
        default:
          throw new Error(`Unknown method: ${method}`);
      }
    },
    {
      onClientCountChange: (count) => {
        clientCount = count;
        maybeScheduleIdleShutdown();
      },
    },
  );

  return handle;
}
