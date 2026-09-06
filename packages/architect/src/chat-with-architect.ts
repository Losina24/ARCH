import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type AgentProgressEvent, runAgentHeadless } from '@losina/agent-runtime';
import type { RunMeta, RunPlan } from '@losina/schemas';
import { buildChatPrompt } from './prompts.js';
import { fileExists } from './util/file-exists.js';

export interface ChatWithArchitectInput {
  run: RunMeta;
  runDir: string;
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
  /** A self-contained prompt for a brand-new ARCH run, when this turn called for real work on the
   * project rather than just an answer — see buildChatPrompt. Absent on an ordinary turn. */
  runRequest?: string;
}

/**
 * One turn of an ongoing, always-resumed conversation with the human who requested this run.
 * Mostly no file/sentinel protocol like review/consultation use — the model's own output is the
 * reply, verbatim, the same way `dispatchWorker` treats a worker's output as its summary. The one
 * exception is the optional run-request file, mirroring runGrillingRound's question.json: present
 * only when this turn decided a brand-new run should be started.
 */
export async function chatWithArchitect(
  input: ChatWithArchitectInput,
): Promise<ChatWithArchitectOutput> {
  const { run, runDir, plan, message } = input;
  const runRequestFilePath = join(runDir, 'chat-run-request.json');
  const prompt = buildChatPrompt({ run, plan, message, runRequestFilePath });

  const { sessionId, output } = await runAgentHeadless({
    prompt,
    model: input.model,
    cwd: run.cwd,
    resumeSessionId: input.resumeSessionId,
    permissionMode: 'bypassPermissions',
    additionalDirs: [dirname(runRequestFilePath)],
    signal: input.signal,
    onProgress: input.onProgress,
  });

  if (!(await fileExists(runRequestFilePath))) {
    return { sessionId, reply: output };
  }

  const raw = await readFile(runRequestFilePath, 'utf-8');
  const parsed = JSON.parse(raw) as { prompt: string };
  await rm(runRequestFilePath);

  return { sessionId, reply: output, runRequest: parsed.prompt };
}
