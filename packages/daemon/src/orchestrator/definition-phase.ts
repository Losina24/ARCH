import { planProject } from '@arch/architect';
import { loadRunSessions, saveRunSessions } from '@arch/core';
import type { AgentMeshConfig } from '@arch/schemas';
import type { RunManager } from '../run-manager.js';
import type { DaemonServerHandle } from '../server.js';
import { getRunDir, persistRunMeta } from './persist.js';

export interface DefinitionPhaseParams {
  runId: string;
  archDir: string;
  config: AgentMeshConfig;
  runManager: RunManager;
  handle: DaemonServerHandle;
  feedback?: string;
  signal?: AbortSignal;
}

export async function runDefinitionPhase(params: DefinitionPhaseParams): Promise<void> {
  const { runId, archDir, config, runManager, handle, feedback, signal } = params;
  const run = runManager.get(runId);
  if (!run) return;

  const runDir = getRunDir(archDir, runId);
  const agentId = `architect-${runId}`;

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

    const plan = await planProject({
      run,
      model: config.models.architectModel,
      feedback,
      resumeSessionId: sessions.architectSessionId,
      signal,
    });

    await saveRunSessions(runDir, { ...sessions, architectSessionId: plan.sessionId });

    const updated = runManager.update(runId, {});
    await persistRunMeta(archDir, updated);

    handle.broadcast({
      type: 'agent:activity',
      runId,
      agentId,
      role: 'architect',
      state: 'completed',
    });
    handle.broadcast({ type: 'run:status-changed', runId, phase: updated.phase });
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
