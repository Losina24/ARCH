import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runClaudeHeadless } from '@arch/claude-runtime';
import type { RunMeta } from '@arch/schemas';
import { buildReviewPrompt } from './prompts.js';
import { fileExists } from './util/file-exists.js';

export interface ReviewTaskInput {
  run: RunMeta;
  taskId: string;
  taskMarkdown: string;
  correctionMarkdowns: string[];
  gitDiff: string;
  model: string;
  correctionFilePath: string;
  workerSummary: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
}

export type ReviewVerdict = { approved: true } | { approved: false; correctionMarkdown: string };

export interface ReviewTaskOutput {
  sessionId: string;
  verdict: ReviewVerdict;
}

export async function reviewTask(input: ReviewTaskInput): Promise<ReviewTaskOutput> {
  const {
    run,
    taskId,
    taskMarkdown,
    correctionMarkdowns,
    gitDiff,
    correctionFilePath,
    workerSummary,
  } = input;

  const prompt = buildReviewPrompt({
    taskId,
    taskMarkdown,
    correctionMarkdowns,
    gitDiff,
    correctionFilePath,
    workerSummary,
  });

  const { sessionId } = await runClaudeHeadless({
    prompt,
    model: input.model,
    cwd: run.cwd,
    resumeSessionId: input.resumeSessionId,
    permissionMode: 'bypassPermissions',
    additionalDirs: [dirname(correctionFilePath)],
    signal: input.signal,
  });

  if (await fileExists(correctionFilePath)) {
    const correctionMarkdown = await readFile(correctionFilePath, 'utf-8');
    return { sessionId, verdict: { approved: false, correctionMarkdown } };
  }

  return { sessionId, verdict: { approved: true } };
}
