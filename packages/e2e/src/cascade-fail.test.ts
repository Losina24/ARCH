import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunHeadlessOptions, RunHeadlessResult } from '@arch/claude-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DaemonHarness, startDaemonHarness } from './support/daemon-harness.js';
import { FakeClaudeRuntime } from './support/fake-claude-runtime.js';
import { type RepoFixture, createRepoFixture } from './support/repo-fixture.js';
import { waitForEvent } from './support/wait-for-event.js';

let runtime: FakeClaudeRuntime | undefined;

vi.mock('@arch/claude-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arch/claude-runtime')>();
  return {
    ...actual,
    runClaudeHeadless: (options: RunHeadlessOptions): Promise<RunHeadlessResult> => {
      if (!runtime) throw new Error('FakeClaudeRuntime not configured for this test');
      return runtime.handle(options);
    },
  };
});

let repo: RepoFixture;
let daemon: DaemonHarness;

beforeEach(async () => {
  runtime = new FakeClaudeRuntime();
  repo = await createRepoFixture();
  daemon = await startDaemonHarness(repo.cwd);
});

afterEach(async () => {
  await daemon.stop();
  await repo.cleanup();
  runtime = undefined;
});

describe('cascade fail', () => {
  it('blocks dependent tasks without ever dispatching them, but keeps unrelated tasks running', async () => {
    await daemon.client.setConfig({ maxRetries: 0 });

    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        {
          id: 'TASK-A',
          title: 'Fails',
          checks: [{ name: 'always-fails', command: 'false', args: [] }],
        },
        { id: 'TASK-B', title: 'Depends on A', dependsOn: ['TASK-A'] },
        { id: 'TASK-C', title: 'Unrelated to A' },
      ],
    });
    runtime?.queueWorker('TASK-A', async () => {});
    runtime?.queueWorker('TASK-C', async ({ cwd }) => {
      await writeFile(join(cwd, 'TASK-C.txt'), 'TASK-C\n', 'utf-8');
    });
    runtime?.queueReview('TASK-C', 'approve');

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({ prompt: 'Do something impossible', cwd: repo.cwd });
    await planReady;

    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      15000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    await runBlocked;

    const finalRun = await daemon.client.getRun({ runId: run.runId });
    expect(finalRun.phase).toBe('blocked');

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    const taskA = plan?.tasksIndex.tasks.find((task) => task.id === 'TASK-A');
    expect(taskA).toMatchObject({ status: 'failed' });
    expect(taskA?.failureReason).toContain('always-fails');

    const taskB = plan?.tasksIndex.tasks.find((task) => task.id === 'TASK-B');
    expect(taskB).toMatchObject({ status: 'blocked' });
    expect(taskB?.failureReason).toBeUndefined();
    expect(runtime?.workerCallCount('TASK-B')).toBe(0);

    // TASK-C does not depend on the failed task, so it keeps running to completion
    // even though the run as a whole ends up blocked.
    expect(plan?.tasksIndex.tasks.find((task) => task.id === 'TASK-C')).toMatchObject({
      status: 'done',
    });
    await expect(readFile(join(repo.cwd, 'TASK-C.txt'), 'utf-8')).resolves.toBe('TASK-C\n');
  });
});
