import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type AgentProgressEvent, runAgentHeadless } from '@losina/agent-runtime';
import { getArchPaths } from '@losina/config';
import type { RunMeta } from '@losina/schemas';
import { buildGrillingAnswerPrompt, buildGrillingPrompt } from './prompts.js';
import { fileExists } from './util/file-exists.js';

export interface GrillingRoundInput {
  run: RunMeta;
  model: string;
  resumeSessionId?: string;
  priorAnswer?: string;
  signal?: AbortSignal;
  onProgress?: (progress: AgentProgressEvent) => void;
}

export type GrillingRoundOutput =
  | { sessionId: string; done: false; question: string; recommendation: string }
  | { sessionId: string; done: true };

export async function runGrillingRound(input: GrillingRoundInput): Promise<GrillingRoundOutput> {
  const { run } = input;
  const { archDir } = getArchPaths(run.cwd);
  const runDir = join(archDir, 'runs', run.runId);
  const questionFilePath = join(runDir, 'question.json');

  const prompt = input.priorAnswer
    ? buildGrillingAnswerPrompt({ run, questionFilePath, priorAnswer: input.priorAnswer })
    : buildGrillingPrompt({ run, questionFilePath });

  const { sessionId } = await runAgentHeadless({
    prompt,
    model: input.model,
    cwd: run.cwd,
    resumeSessionId: input.resumeSessionId,
    permissionMode: 'bypassPermissions',
    additionalDirs: [dirname(questionFilePath)],
    signal: input.signal,
    onProgress: input.onProgress,
  });

  if (!(await fileExists(questionFilePath))) {
    return { sessionId, done: true };
  }

  const raw = await readFile(questionFilePath, 'utf-8');
  const parsed = JSON.parse(raw) as { question: string; recommendation: string };
  await rm(questionFilePath);

  return {
    sessionId,
    done: false,
    question: parsed.question,
    recommendation: parsed.recommendation,
  };
}
