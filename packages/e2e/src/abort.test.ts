import type { RunHeadlessOptions, RunHeadlessResult } from '@losina/claude-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DaemonHarness, startDaemonHarness } from './support/daemon-harness.js';
import { FakeClaudeRuntime } from './support/fake-claude-runtime.js';
import { type RepoFixture, createRepoFixture } from './support/repo-fixture.js';
import { waitForEvent } from './support/wait-for-event.js';

let runtime: FakeClaudeRuntime | undefined;

vi.mock('@losina/claude-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@losina/claude-runtime')>();
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

describe('abort', () => {
  it('stops the run once an in-flight worker call is aborted', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Blocks forever' }],
    });
    // Never resolves on its own — only reacts to the run's AbortSignal, so the task cycle stays
    // "in flight" until the test explicitly calls abortRun().
    runtime?.queueWorker(
      'TASK-001',
      (options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('worker aborted')));
        }),
    );

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({ prompt: 'Do something slow', cwd: repo.cwd });
    await planReady;

    const workerThinking = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'agent:activity' && event.role === 'worker' && event.state === 'thinking',
    );
    const approved = await daemon.client.approveRun({ runId: run.runId });
    expect(approved.phase).toBe('implementation');
    await workerThinking;

    const workerFailed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'agent:activity' && event.role === 'worker' && event.state === 'failed',
      30000,
    );
    await daemon.client.abortRun({ runId: run.runId });
    await workerFailed;

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(finalPlan?.tasksIndex.tasks[0]).toMatchObject({ id: 'TASK-001', status: 'failed' });

    const finalRun = await daemon.client.getRun({ runId: run.runId });
    expect(finalRun.phase).toBe('implementation');

    await expect(daemon.client.abortRun({ runId: run.runId })).rejects.toThrow(
      'has no active work to abort',
    );
  });
});
