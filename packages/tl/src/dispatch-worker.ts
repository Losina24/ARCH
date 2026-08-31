import { runAgentHeadless } from '@losina/agent-runtime';
import { type WorktreeHandle, getStagedFiles, stageAll } from '@losina/core';
import type { Task } from '@losina/schemas';
import { type CorrectionSource, buildWorkerPrompt } from './prompts.js';

export interface DispatchWorkerInput {
  task: Task;
  taskMarkdown: string;
  worktree: WorktreeHandle;
  model: string;
  resumeSessionId?: string;
  correctionMarkdown?: string;
  /** Who's behind correctionMarkdown, so the prompt attributes it accurately. Defaults to 'review'. */
  correctionSource?: CorrectionSource;
  /** A human's note to the worker, injected only on a fresh dispatch (no correctionMarkdown). */
  humanMessage?: string;
  signal?: AbortSignal;
  /**
   * Overrides how changed files are detected after the worker runs. Defaults to staging
   * everything (`stageAll` + `getStagedFiles`), which is safe when the task has an isolated
   * worktree. Pass a read-only detector (e.g. `getChangedFiles`) when several tasks share the
   * same working directory concurrently, so detecting one task's changes never stages — and
   * thereby never risks committing — another task's still in-progress edits.
   */
  detectChanges?: (cwd: string) => Promise<string[]>;
}

export interface DispatchWorkerOutput {
  sessionId: string;
  filesChanged: string[];
  summary: string;
}

export async function dispatchWorker(input: DispatchWorkerInput): Promise<DispatchWorkerOutput> {
  const prompt = buildWorkerPrompt(
    input.taskMarkdown,
    input.correctionMarkdown,
    input.humanMessage,
    input.correctionSource,
    input.task.checks,
  );

  const { sessionId, output } = await runAgentHeadless({
    prompt,
    model: input.model,
    cwd: input.worktree.path,
    resumeSessionId: input.resumeSessionId,
    // The Worker needs Bash to install dependencies, build, and run tests itself instead of
    // operating blind and finding out only from the next automated-check verdict. With
    // worktree isolation (config.execution.useWorktrees) every command it runs is confined
    // to its own worktree and branch, never touching run.cwd directly until the Architect
    // approves the merge — with worktrees disabled, worktree.path IS run.cwd, so this grants
    // the Worker unattended Bash directly in the user's real project.
    permissionMode: 'bypassPermissions',
    signal: input.signal,
  });

  const filesChanged = input.detectChanges
    ? await input.detectChanges(input.worktree.path)
    : await (async () => {
        await stageAll(input.worktree.path);
        return getStagedFiles(input.worktree.path);
      })();

  return { sessionId, filesChanged, summary: output };
}
