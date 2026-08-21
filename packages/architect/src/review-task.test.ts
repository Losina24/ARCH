import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaudeHeadless } from '@arch/claude-runtime';
import type { RunMeta, Task } from '@arch/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewTask } from './review-task.js';

vi.mock('@arch/claude-runtime', () => ({ runClaudeHeadless: vi.fn() }));

const mockedRunClaudeHeadless = vi.mocked(runClaudeHeadless);

describe('reviewTask', () => {
  let cwd: string;
  let run: RunMeta;
  let task: Task;
  let correctionFilePath: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'arch-review-task-test-'));
    run = {
      runId: 'run-1',
      title: 'Add add(a, b)',
      prompt: 'Add a function that sums two numbers',
      cwd,
      phase: 'implementation',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    };
    task = {
      id: 'TASK-001',
      title: 'Add add(a, b)',
      status: 'in_review',
      dependsOn: [],
      file: 'tasks/TASK-001.md',
      correctionFiles: [],
      retries: 0,
      checks: [],
    };
    correctionFilePath = join(cwd, 'TASK-001.correction-1.md');
    mockedRunClaudeHeadless.mockReset();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('approves the task when the agent leaves no correction file behind', async () => {
    mockedRunClaudeHeadless.mockResolvedValue({ sessionId: 'session-1', output: 'APPROVED' });

    const { verdict, sessionId } = await reviewTask({
      run,
      taskId: task.id,
      taskMarkdown: '# Task brief',
      correctionMarkdowns: [],
      gitDiff: 'diff --git a/src/index.js b/src/index.js',
      model: 'sonnet',
      correctionFilePath,
      workerSummary: 'Implemented add(a, b) in src/index.js.',
    });

    expect(sessionId).toBe('session-1');
    expect(verdict).toEqual({ approved: true });
  });

  it('requests a correction when the agent writes the correction file', async () => {
    mockedRunClaudeHeadless.mockImplementation(async () => {
      await writeFile(correctionFilePath, 'Handle the negative-number case too.', 'utf-8');
      return { sessionId: 'session-2', output: 'NEEDS_CORRECTION' };
    });

    const { verdict } = await reviewTask({
      run,
      taskId: task.id,
      taskMarkdown: '# Task brief',
      correctionMarkdowns: [],
      gitDiff: 'diff',
      model: 'sonnet',
      correctionFilePath,
      workerSummary: 'Added a negative-number check.',
    });

    expect(verdict).toEqual({
      approved: false,
      correctionMarkdown: 'Handle the negative-number case too.',
    });
  });

  it('forwards model, cwd, resumeSessionId and signal to runClaudeHeadless', async () => {
    mockedRunClaudeHeadless.mockResolvedValue({ sessionId: 'session-1', output: 'APPROVED' });
    const controller = new AbortController();

    await reviewTask({
      run,
      taskId: task.id,
      taskMarkdown: '# Task brief',
      correctionMarkdowns: [],
      gitDiff: 'diff',
      model: 'opus',
      correctionFilePath,
      workerSummary: 'Implemented add(a, b).',
      resumeSessionId: 'previous-session',
      signal: controller.signal,
    });

    const call = mockedRunClaudeHeadless.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model: 'opus',
      cwd,
      resumeSessionId: 'previous-session',
      signal: controller.signal,
      permissionMode: 'bypassPermissions',
    });
  });

  it('includes the worker summary in the prompt sent to runClaudeHeadless', async () => {
    mockedRunClaudeHeadless.mockResolvedValue({ sessionId: 'session-1', output: 'APPROVED' });

    await reviewTask({
      run,
      taskId: task.id,
      taskMarkdown: '# Task brief',
      correctionMarkdowns: [],
      gitDiff: 'diff',
      model: 'sonnet',
      correctionFilePath,
      workerSummary: 'Implemented add(a, b) using a simple sum.',
    });

    const call = mockedRunClaudeHeadless.mock.calls[0]?.[0];
    expect(call?.prompt).toContain('Implemented add(a, b) using a simple sum.');
  });
});
