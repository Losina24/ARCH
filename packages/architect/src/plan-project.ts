import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runClaudeHeadless } from '@losina/claude-runtime';
import { getArchPaths } from '@losina/config';
import { loadTasksIndex } from '@losina/core';
import type { RunMeta, RunPlan } from '@losina/schemas';
import { buildPlanPrompt, buildRefinePlanPrompt } from './prompts.js';

export interface PlanProjectInput {
  run: RunMeta;
  model: string;
  feedback?: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
}

export interface PlanProjectOutput extends RunPlan {
  sessionId: string;
}

export async function planProject(input: PlanProjectInput): Promise<PlanProjectOutput> {
  const { run } = input;
  const { archDir } = getArchPaths(run.cwd);
  const runDir = join(archDir, 'runs', run.runId);
  const projectMarkdownPath = join(runDir, 'project.md');
  const tasksIndexPath = join(runDir, 'tasks-index.yaml');
  const tasksDirPath = join(runDir, 'tasks');

  const promptInput = {
    run,
    projectMarkdownPath,
    tasksIndexPath,
    tasksDirPath,
  };

  const prompt = input.feedback
    ? buildRefinePlanPrompt({ ...promptInput, feedback: input.feedback })
    : buildPlanPrompt(promptInput);

  const { sessionId } = await runClaudeHeadless({
    prompt,
    model: input.model,
    cwd: run.cwd,
    resumeSessionId: input.resumeSessionId,
    permissionMode: 'bypassPermissions',
    additionalDirs: [runDir],
    signal: input.signal,
  });

  const [projectMarkdown, tasksIndex] = await Promise.all([
    readFile(projectMarkdownPath, 'utf-8'),
    loadTasksIndex(tasksIndexPath),
  ]);

  return { sessionId, projectMarkdown, tasksIndex };
}
