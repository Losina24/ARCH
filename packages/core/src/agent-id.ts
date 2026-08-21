/** The worker agent id for a given task — the single source of truth for this convention, shared between the orchestrator loop and any RPC handler that needs to address the same agent (e.g. a human-prompt broadcast). */
export function workerAgentId(taskId: string): string {
  return `worker-${taskId}`;
}
