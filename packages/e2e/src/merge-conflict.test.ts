import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunHeadlessOptions, RunHeadlessResult } from '@losina/claude-runtime';
import { execa } from 'execa';
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

function waitForTaskStatus(taskId: string, status: string) {
  return waitForEvent(
    daemon.client,
    (event) =>
      event.type === 'task:status-changed' && event.taskId === taskId && event.status === status,
    20000,
  );
}

describe('integrating an approved task that conflicts with what already landed', () => {
  it('syncs the worktree with the base branch, resolves a real Git conflict there, and lands a clean fast-forward merge — the way a human developer would', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        { id: 'TASK-001', title: 'Write shared file (version A)' },
        { id: 'TASK-002', title: 'Write shared file (version B)' },
      ],
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'shared.txt'), 'from TASK-001\n', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');

    // TASK-002's worktree forks from the same initial commit as TASK-001's, before either has
    // landed — waiting for TASK-001 to actually reach 'done' here only delays when the Worker
    // writes its own conflicting content; it does not change which commit the worktree branched
    // from, so the base-sync during TASK-002's own integration still has something to conflict
    // with once TASK-001's change is already on the base branch.
    runtime?.queueWorker('TASK-002', async ({ cwd }) => {
      await waitForTaskStatus('TASK-001', 'done');
      await writeFile(join(cwd, 'shared.txt'), 'from TASK-002\n', 'utf-8');
    });
    runtime?.queueReview('TASK-002', 'approve');
    // The conflict-resolution re-dispatch: resolves the conflict exactly how a human would,
    // keeping both sides.
    runtime?.queueWorker('TASK-002', async ({ cwd }) => {
      await writeFile(join(cwd, 'shared.txt'), 'from TASK-001 and TASK-002\n', 'utf-8');
    });

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({
      prompt: 'Write a shared file from two independent tasks',
      cwd: repo.cwd,
    });
    await planReady;

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      20000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    await runDone;

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(
      finalPlan?.tasksIndex.tasks.map((task) => ({ id: task.id, status: task.status })),
    ).toEqual([
      { id: 'TASK-001', status: 'done' },
      { id: 'TASK-002', status: 'done' },
    ]);

    // Both tasks' work actually landed, reconciled by the conflict-resolution round.
    await expect(readFile(join(repo.cwd, 'shared.txt'), 'utf-8')).resolves.toBe(
      'from TASK-001 and TASK-002\n',
    );

    // repoRoot itself — the user's real repo — must never end up mid-merge.
    const status = await execa('git', ['status', '--porcelain'], { cwd: repo.cwd });
    expect(status.stdout.trim()).toBe('');

    const log = await execa('git', ['log', '--oneline'], { cwd: repo.cwd });
    expect(log.stdout).toContain('TASK-001');
    expect(log.stdout).toContain('TASK-002: merge main');
  });

  it('preserves the approved branch and asks a human when the worker cannot resolve the conflict after repeated attempts', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        { id: 'TASK-001', title: 'Write shared file (version A)' },
        { id: 'TASK-002', title: 'Write shared file (version B)' },
      ],
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'shared.txt'), 'from TASK-001\n', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');
    runtime?.queueWorker('TASK-002', async ({ cwd }) => {
      await waitForTaskStatus('TASK-001', 'done');
      await writeFile(join(cwd, 'shared.txt'), 'from TASK-002\n', 'utf-8');
    });
    runtime?.queueReview('TASK-002', 'approve');
    // Deliberately no further queued workers for TASK-002 — every conflict-resolution
    // re-dispatch is a no-op that leaves the merge markers untouched, exhausting the budget.

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({
      prompt: 'Write a shared file from two independent tasks',
      cwd: repo.cwd,
    });
    await planReady;

    const task002AwaitingHuman = waitForTaskStatus('TASK-002', 'awaiting_human');
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      20000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    const event = await task002AwaitingHuman;
    if (event.type !== 'task:status-changed') throw new Error('unreachable');
    expect(event.failureReason).toContain('shared.txt');
    expect(event.failureReason).toContain('feat/TASK-002');
    await runBlocked;

    // TASK-001 landed fine — only TASK-002's own integration is stuck.
    await expect(readFile(join(repo.cwd, 'shared.txt'), 'utf-8')).resolves.toBe('from TASK-001\n');

    // repoRoot must never be left mid-merge, even though this task never got integrated.
    const status = await execa('git', ['status', '--porcelain'], { cwd: repo.cwd });
    expect(status.stdout.trim()).toBe('');

    // The already-approved work is not discarded — its branch survives for a human to resolve.
    const branches = await execa('git', ['branch', '--list', 'feat/TASK-002'], { cwd: repo.cwd });
    expect(branches.stdout.trim()).not.toBe('');
  });
});
