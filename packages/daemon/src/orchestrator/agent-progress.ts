import type { AgentProgressEvent } from '@losina/agent-runtime';
import type { AgentActivityEvent, AgentRole } from '@losina/ipc';

export interface AgentProgressContext {
  runId: string;
  agentId: string;
  role: AgentRole;
  taskId?: string;
}

/** Adds run/agent identity to an already-sanitized provider progress update. */
export function activityFromProgress(
  context: AgentProgressContext,
  progress: AgentProgressEvent,
): AgentActivityEvent {
  return {
    type: 'agent:activity',
    ...context,
    state: progress.state,
    detail: progress.detail,
    tool: progress.tool,
    file: progress.file,
  };
}
