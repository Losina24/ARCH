import { type AgentProgressEvent, runAgentHeadless } from '@losina/agent-runtime';
import type { RunMeta, RunPlan } from '@losina/schemas';
import { buildChatPrompt } from './prompts.js';

export interface ChatWithArchitectInput {
  run: RunMeta;
  plan: RunPlan | null;
  message: string;
  model: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: AgentProgressEvent) => void;
}

export interface ChatWithArchitectOutput {
  sessionId: string;
  reply: string;
}

/**
 * One turn of an ongoing, always-resumed conversation with the human who requested this run.
 * Deliberately no file/sentinel protocol like review/consultation use — the model's own output is
 * the reply, verbatim, the same way `dispatchWorker` treats a worker's output as its summary.
 */
export async function chatWithArchitect(
  input: ChatWithArchitectInput,
): Promise<ChatWithArchitectOutput> {
  const { run, plan, message } = input;
  const prompt = buildChatPrompt({ run, plan, message });

  const { sessionId, output } = await runAgentHeadless({
    prompt,
    model: input.model,
    cwd: run.cwd,
    resumeSessionId: input.resumeSessionId,
    permissionMode: 'bypassPermissions',
    signal: input.signal,
    onProgress: input.onProgress,
  });

  return { sessionId, reply: output };
}
