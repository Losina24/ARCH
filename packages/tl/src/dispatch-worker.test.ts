import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentHeadless } from '@losina/agent-runtime';
import type { WorktreeHandle } from '@losina/core';
import type { Task } from '@losina/schemas';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchWorker } from './dispatch-worker.js';

vi.mock('@losina/agent-runtime', () => ({ runAgentHeadless: vi.fn() }));

const mockedRunAgentHeadless = vi.mocked(runAgentHeadless);

const task: Task = {
  id: 'TASK-001',
  title: 'Add add(a, b)',
  status: 'in_progress',
  dependsOn: [],
  file: 'tasks/TASK-001.md',
  correctionFiles: [],
  retries: 0,
  checks: [],
};

describe('dispatchWorker', () => {
  let worktree: WorktreeHandle;

  beforeEach(async () => {
    const path = await mkdtemp(join(tmpdir(), 'arch-dispatch-worker-test-'));
    await execa('git', ['init'], { cwd: path });
    await execa('git', ['config', 'user.email', 'arch-test@example.com'], { cwd: path });
    await execa('git', ['config', 'user.name', 'ARCH Test'], { cwd: path });
    await writeFile(join(path, 'README.md'), '# initial\n', 'utf-8');
    await execa('git', ['add', '-A'], { cwd: path });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: path });

    worktree = { path, branch: 'feat/TASK-001' };
    mockedRunAgentHeadless.mockReset();
  });

  afterEach(async () => {
    await rm(worktree.path, { recursive: true, force: true });
  });

  it('stages the files the agent wrote and reports them as filesChanged', async () => {
    mockedRunAgentHeadless.mockImplementation(async () => {
      await writeFile(join(worktree.path, 'src/index.js'), 'exports.add = (a, b) => a + b;', {
        flag: 'wx',
      }).catch(async () => {
        await writeFile(join(worktree.path, 'index.js'), 'exports.add = (a, b) => a + b;');
      });
      return { sessionId: 'session-1', output: 'Implemented add(a, b).' };
    });

    const result = await dispatchWorker({
      task,
      taskMarkdown: '# Task brief',
      worktree,
      model: 'sonnet',
    });

    expect(result.sessionId).toBe('session-1');
    expect(result.summary).toBe('Implemented add(a, b).');
    expect(result.filesChanged).toContain('index.js');
  });

  it('reports no changed files when the agent made none', async () => {
    mockedRunAgentHeadless.mockResolvedValue({
      sessionId: 'session-1',
      output: 'No changes needed.',
    });

    const result = await dispatchWorker({
      task,
      taskMarkdown: '# Task brief',
      worktree,
      model: 'sonnet',
    });

    expect(result.filesChanged).toEqual([]);
  });

  it('builds a correction prompt when correctionMarkdown is set, and forwards resumeSessionId/signal', async () => {
    mockedRunAgentHeadless.mockResolvedValue({ sessionId: 'session-2', output: 'Fixed.' });
    const controller = new AbortController();

    await dispatchWorker({
      task,
      taskMarkdown: '# Task brief',
      worktree,
      model: 'sonnet',
      correctionMarkdown: 'Handle negative numbers too.',
      resumeSessionId: 'previous-session',
      signal: controller.signal,
    });

    const call = mockedRunAgentHeadless.mock.calls[0]?.[0];
    expect(call?.prompt).toContain('Handle negative numbers too.');
    expect(call).toMatchObject({
      cwd: worktree.path,
      model: 'sonnet',
      resumeSessionId: 'previous-session',
      signal: controller.signal,
      permissionMode: 'bypassPermissions',
    });
  });

  it('attributes the correction to the source given in correctionSource', async () => {
    mockedRunAgentHeadless.mockResolvedValue({ sessionId: 'session-4', output: 'Fixed.' });

    await dispatchWorker({
      task,
      taskMarkdown: '# Task brief',
      worktree,
      model: 'sonnet',
      correctionMarkdown: 'The build check failed.',
      correctionSource: 'checks',
    });

    const call = mockedRunAgentHeadless.mock.calls[0]?.[0];
    expect(call?.prompt).toContain('The Team Lead ran');
  });

  it('embeds humanMessage in the prompt on a fresh dispatch', async () => {
    mockedRunAgentHeadless.mockResolvedValue({ sessionId: 'session-3', output: 'Retried.' });

    await dispatchWorker({
      task,
      taskMarkdown: '# Task brief',
      worktree,
      model: 'sonnet',
      humanMessage: 'Try using the v2 API instead.',
    });

    const call = mockedRunAgentHeadless.mock.calls[0]?.[0];
    expect(call?.prompt).toContain('Try using the v2 API instead.');
  });

  it("passes the task's exact check commands into the prompt so the worker can verify against them", async () => {
    mockedRunAgentHeadless.mockResolvedValue({ sessionId: 'session-5', output: 'Done.' });

    await dispatchWorker({
      task: {
        ...task,
        checks: [{ name: 'build', command: 'pnpm', args: ['--filter', 'some-app', 'build'] }],
      },
      taskMarkdown: '# Task brief',
      worktree,
      model: 'sonnet',
    });

    const call = mockedRunAgentHeadless.mock.calls[0]?.[0];
    expect(call?.prompt).toContain('- build: pnpm --filter some-app build');
  });
});
