import { runGrillingRound } from '@losina/architect';
import { loadRunSessions, saveRunSessions } from '@losina/core';
import type { AgentMeshConfig } from '@losina/schemas';
import type { RunManager } from '../run-manager.js';
import type { DaemonServerHandle } from '../server.js';
import { activityFromProgress } from './agent-progress.js';
import { getRunDir, persistRunMeta } from './persist.js';

export interface GrillingPhaseParams {
  runId: string;
  archDir: string;
  config: AgentMeshConfig;
  runManager: RunManager;
  handle: DaemonServerHandle;
  answer?: { text: string } | { skipped: true };
  signal?: AbortSignal;
  triggerDefinitionPhase: (runId: string) => void;
}

export async function runGrillingPhase(params: GrillingPhaseParams): Promise<void> {
  const { runId, archDir, config, runManager, handle, answer, signal, triggerDefinitionPhase } =
    params;
  const run = runManager.get(runId);
  if (!run) return;

  const runDir = getRunDir(archDir, runId);
  const agentId = `architect-${runId}`;

  // No 'run:status-changed' broadcast here: clients (TUI, e2e tests) treat that event with
  // phase 'definition' as "the plan is ready" — runDefinitionPhase itself broadcasts it once
  // the plan actually exists, so firing it early here would make readers race ahead of the plan.
  if (answer && 'skipped' in answer) {
    const updated = runManager.update(runId, { phase: 'definition' });
    await persistRunMeta(archDir, updated);
    triggerDefinitionPhase(runId);
    return;
  }

  handle.broadcast({
    type: 'agent:activity',
    runId,
    agentId,
    role: 'architect',
    state: 'spawning',
  });

  try {
    const sessions = await loadRunSessions(runDir);

    handle.broadcast({
      type: 'agent:activity',
      runId,
      agentId,
      role: 'architect',
      state: 'thinking',
    });

    const result = await runGrillingRound({
      run,
      model: config.models.architectModel,
      resumeSessionId: sessions.architectSessionId,
      priorAnswer: answer?.text,
      signal,
      onProgress: (progress) =>
        handle.broadcast(activityFromProgress({ runId, agentId, role: 'architect' }, progress)),
    });

    await saveRunSessions(runDir, { ...sessions, architectSessionId: result.sessionId });

    handle.broadcast({
      type: 'agent:activity',
      runId,
      agentId,
      role: 'architect',
      state: 'completed',
    });

    if (result.done) {
      const updated = runManager.update(runId, { phase: 'definition' });
      await persistRunMeta(archDir, updated);
      triggerDefinitionPhase(runId);
      return;
    }

    const seq = sessions.grillingSeq + 1;
    await saveRunSessions(runDir, {
      ...sessions,
      architectSessionId: result.sessionId,
      grillingSeq: seq,
    });

    handle.broadcast({
      type: 'grilling:question-asked',
      runId,
      seq,
      question: result.question,
      recommendation: result.recommendation,
    });
  } catch (error) {
    handle.broadcast({
      type: 'agent:activity',
      runId,
      agentId,
      role: 'architect',
      state: 'failed',
    });
    throw error;
  }
}
