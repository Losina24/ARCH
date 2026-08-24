import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunHeadlessOptions, RunHeadlessResult } from '@losina/claude-runtime';
import { getArchPaths } from '@losina/config';
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('scope-based locking (useWorktrees: false)', () => {
  it('runs tasks with disjoint scopes directly on the repo, without creating any worktree', async () => {
    await daemon.client.setConfig({ useWorktrees: false });

    runtime?.queuePlan({
      projectMarkdown: '# Brief\n\nAdd two independent files.',
      tasks: [
        { id: 'TASK-A', title: 'Write file A', scope: ['a.txt'] },
        { id: 'TASK-B', title: 'Write file B', scope: ['b.txt'] },
      ],
    });
    for (const id of ['TASK-A', 'TASK-B']) {
      runtime?.queueWorker(id, async ({ cwd }) => {
        await writeFile(join(cwd, `${id === 'TASK-A' ? 'a' : 'b'}.txt`), `${id}\n`, 'utf-8');
      });
      runtime?.queueReview(id, 'approve');
    }

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({ prompt: 'Add two files', cwd: repo.cwd });
    await planReady;

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    await runDone;

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    for (const id of ['TASK-A', 'TASK-B']) {
      expect(finalPlan?.tasksIndex.tasks.find((task) => task.id === id)).toMatchObject({
        status: 'done',
      });
    }
    await expect(readFile(join(repo.cwd, 'a.txt'), 'utf-8')).resolves.toBe('TASK-A\n');
    await expect(readFile(join(repo.cwd, 'b.txt'), 'utf-8')).resolves.toBe('TASK-B\n');

    const { runsDir } = getArchPaths(repo.cwd);
    const worktreesDir = join(runsDir, run.runId, 'worktrees');
    expect(await pathExists(worktreesDir)).toBe(false);
  });

  it('rejects a worker change outside the declared scope, then accepts the correction', async () => {
    await daemon.client.setConfig({ useWorktrees: false });

    runtime?.queuePlan({
      projectMarkdown: '# Brief\n\nAdd a file within scope.',
      tasks: [{ id: 'TASK-001', title: 'Write in-scope file', scope: ['allowed.txt'] }],
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'allowed.txt'), 'ok\n', 'utf-8');
      await writeFile(join(cwd, 'outside.txt'), 'oops\n', 'utf-8');
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await rm(join(cwd, 'outside.txt'));
    });
    runtime?.queueReview('TASK-001', 'approve');

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({ prompt: 'Add an in-scope file', cwd: repo.cwd });
    await planReady;

    const needsCorrection = waitForEvent(
      daemon.client,
      (event) => event.type === 'task:status-changed' && event.status === 'needs_correction',
      15000,
    );
    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    await needsCorrection;
    await runDone;

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(finalPlan?.tasksIndex.tasks[0]).toMatchObject({
      id: 'TASK-001',
      status: 'done',
      retries: 1,
    });
    expect(runtime?.workerCallCount('TASK-001')).toBe(2);

    await expect(readFile(join(repo.cwd, 'allowed.txt'), 'utf-8')).resolves.toBe('ok\n');
    expect(await pathExists(join(repo.cwd, 'outside.txt'))).toBe(false);
  });

  it('reverts every file a task wrote once its scope violation exhausts the retry budget', async () => {
    await daemon.client.setConfig({ useWorktrees: false, maxRetries: 0 });

    runtime?.queuePlan({
      projectMarkdown: '# Brief\n\nAdd a file within scope.',
      tasks: [{ id: 'TASK-001', title: 'Write in-scope file', scope: ['allowed.txt'] }],
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'allowed.txt'), 'ok\n', 'utf-8');
      await writeFile(join(cwd, 'outside.txt'), 'oops\n', 'utf-8');
    });

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({ prompt: 'Add an in-scope file', cwd: repo.cwd });
    await planReady;

    const taskFailed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'failed',
      15000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      15000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    await taskFailed;
    await runBlocked;

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(finalPlan?.tasksIndex.tasks[0]).toMatchObject({ id: 'TASK-001', status: 'failed' });

    // Neither the in-scope nor the out-of-scope file ever got committed, so both must be
    // reverted — otherwise they'd sit dirty in the shared repo forever, waiting to be
    // misattributed to whichever task checks its own scope next.
    expect(await pathExists(join(repo.cwd, 'allowed.txt'))).toBe(false);
    expect(await pathExists(join(repo.cwd, 'outside.txt'))).toBe(false);
  });

  it("never flags an already-done dependency's staged-but-uncommitted file as a dependent task's own scope violation", async () => {
    // Regression test: TASK-001 finishes and is approved before TASK-002 (its dependent) is
    // even dispatched, so TASK-001 is no longer "in flight" by the time TASK-002's own files
    // are attributed. ARCH never auto-commits without worktree isolation, so TASK-001's
    // approved a.txt is still sitting staged-but-uncommitted in the shared repo —
    // indistinguishable, to `git status`, from TASK-002's own b.txt. Without excluding a.txt
    // by TASK-001's declared scope regardless of its status, TASK-002 would see a.txt as
    // "changed outside its own declared scope" and get a bogus needs_correction round (or,
    // with no retry budget left, an outright failure) telling its worker to "revert" a file
    // that isn't even its own — which is exactly what actually deleted an approved task's
    // work from disk in production.
    await daemon.client.setConfig({ useWorktrees: false });

    runtime?.queuePlan({
      projectMarkdown: '# Brief\n\nAdd a file, then a dependent task that adds another.',
      tasks: [
        { id: 'TASK-001', title: 'Write file A', scope: ['a.txt'] },
        {
          id: 'TASK-002',
          title: 'Write file B',
          dependsOn: ['TASK-001'],
          scope: ['b.txt'],
        },
      ],
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'a.txt'), 'TASK-001\n', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');
    runtime?.queueWorker('TASK-002', async ({ cwd }) => {
      await writeFile(join(cwd, 'b.txt'), 'TASK-002\n', 'utf-8');
    });
    runtime?.queueReview('TASK-002', 'approve');

    const statusEvents: string[] = [];
    const unsubscribe = daemon.client.onEvent((event) => {
      console.log('EVT', JSON.stringify(event));
      if (event.type === 'task:status-changed' && event.taskId === 'TASK-002') {
        statusEvents.push(event.status);
      }
    });

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({
      prompt: 'Add a file, then a dependent that adds another',
      cwd: repo.cwd,
    });
    await planReady;

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    await runDone;
    unsubscribe();

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(finalPlan?.tasksIndex.tasks.find((task) => task.id === 'TASK-001')).toMatchObject({
      status: 'done',
    });
    expect(finalPlan?.tasksIndex.tasks.find((task) => task.id === 'TASK-002')).toMatchObject({
      status: 'done',
      retries: 0,
    });

    // A bogus scope violation would have routed TASK-002 through 'needs_correction' (or
    // straight to 'failed') before ever reaching review, and dispatched its worker a second
    // time to "fix" a violation that was never really its own.
    expect(statusEvents).not.toContain('needs_correction');
    expect(runtime?.workerCallCount('TASK-002')).toBe(1);

    await expect(readFile(join(repo.cwd, 'a.txt'), 'utf-8')).resolves.toBe('TASK-001\n');
    await expect(readFile(join(repo.cwd, 'b.txt'), 'utf-8')).resolves.toBe('TASK-002\n');
  });
});
