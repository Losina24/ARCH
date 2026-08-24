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

describe('refine', () => {
  it('lets the user request changes to the plan before approving it', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# v1 brief',
      tasks: [{ id: 'TASK-001', title: 'First draft' }],
    });
    runtime?.queuePlan({
      projectMarkdown: '# v2 brief',
      tasks: [
        { id: 'TASK-001', title: 'First draft' },
        { id: 'TASK-002', title: 'Second task' },
      ],
    });

    const firstPlanReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({ prompt: 'Build something', cwd: repo.cwd });
    await firstPlanReady;

    const firstPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(firstPlan?.projectMarkdown).toBe('# v1 brief');
    expect(firstPlan?.tasksIndex.tasks).toHaveLength(1);

    const secondPlanReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const refined = await daemon.client.refineRun({
      runId: run.runId,
      feedback: 'add a second task',
    });
    expect(refined.phase).toBe('definition');
    await secondPlanReady;

    const secondPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(secondPlan?.projectMarkdown).toBe('# v2 brief');
    expect(secondPlan?.tasksIndex.tasks.map((task) => task.id)).toEqual(['TASK-001', 'TASK-002']);
  });
});
