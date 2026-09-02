import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type AgentProgressEvent, runAgentHeadless } from '@losina/agent-runtime';
import { getArchPaths } from '@losina/config';
import { discoverReposIn, loadTasksIndex, resolveRepoRoot } from '@losina/core';
import type { RunMeta, RunPlan } from '@losina/schemas';
import { buildPlanPrompt, buildRefinePlanPrompt } from './prompts.js';

/**
 * The repos the Architect should know about for this run: empty when `run.cwd` is itself a
 * single repository (nothing extra to say — every task just omits `repoRoot`), or the list of
 * git repos found as immediate subdirectories when `run.cwd` is a plain container folder.
 */
async function discoverReposForPrompt(cwd: string): Promise<string[]> {
  try {
    await resolveRepoRoot(cwd);
    return [];
  } catch {
    return discoverReposIn(cwd);
  }
}

export interface PlanProjectInput {
  run: RunMeta;
  model: string;
  feedback?: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: AgentProgressEvent) => void;
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

  const repos = await discoverReposForPrompt(run.cwd);
  const promptInput = {
    run,
    projectMarkdownPath,
    tasksIndexPath,
    tasksDirPath,
    repos,
  };

  const prompt = input.feedback
    ? buildRefinePlanPrompt({ ...promptInput, feedback: input.feedback })
    : buildPlanPrompt(promptInput);

  const { sessionId } = await runAgentHeadless({
    prompt,
    model: input.model,
    cwd: run.cwd,
    resumeSessionId: input.resumeSessionId,
    permissionMode: 'bypassPermissions',
    additionalDirs: [runDir],
    signal: input.signal,
    onProgress: input.onProgress,
  });

  const [projectMarkdown, tasksIndex] = await Promise.all([
    readFile(projectMarkdownPath, 'utf-8'),
    loadTasksIndex(tasksIndexPath),
  ]);

  return { sessionId, projectMarkdown, tasksIndex };
}
