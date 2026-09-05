import { readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type AgentProgressEvent, runAgentHeadless } from '@losina/agent-runtime';
import type { ConsultationFailureKind, RunMeta } from '@losina/schemas';
import { buildConsultationPrompt } from './prompts.js';
import { fileExists } from './util/file-exists.js';

export interface ConsultStuckTaskInput {
  run: RunMeta;
  taskId: string;
  taskMarkdown: string;
  correctionMarkdowns: string[];
  gitDiff: string;
  workerSummary: string;
  failureReason: string;
  failureKind: ConsultationFailureKind;
  retriesSpent: number;
  maxRetries: number;
  model: string;
  consultationFilePath: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: AgentProgressEvent) => void;
}

export type ConsultStuckTaskOutput =
  | { sessionId: string; question: string; recommendation: string }
  | { sessionId: string; question?: undefined; recommendation?: undefined };

/**
 * Asks the Architect to turn a stuck task into a human-facing question, mirroring
 * runGrillingRound's protocol: the Architect either writes {question, recommendation} JSON to
 * `consultationFilePath`, or writes nothing when it has nothing useful to ask — that's not an
 * error, just "no question this time".
 */
export async function consultStuckTask(
  input: ConsultStuckTaskInput,
): Promise<ConsultStuckTaskOutput> {
  const { run, consultationFilePath } = input;

  const prompt = buildConsultationPrompt(input);

  const { sessionId } = await runAgentHeadless({
    prompt,
    model: input.model,
    cwd: run.cwd,
    resumeSessionId: input.resumeSessionId,
    permissionMode: 'bypassPermissions',
    additionalDirs: [dirname(consultationFilePath)],
    signal: input.signal,
    onProgress: input.onProgress,
  });

  if (!(await fileExists(consultationFilePath))) {
    return { sessionId };
  }

  const raw = await readFile(consultationFilePath, 'utf-8');
  const parsed = JSON.parse(raw) as { question: string; recommendation: string };
  await rm(consultationFilePath);

  return { sessionId, question: parsed.question, recommendation: parsed.recommendation };
}
