import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ClaudeApiRejectionError,
  ClaudeStreamAbortedError,
  type RunHeadlessOptions,
  type RunHeadlessResult,
} from '@losina/claude-runtime';
import { CodexTimeoutError } from '@losina/codex-runtime';
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

async function createAndApprove(prompt: string) {
  const planReady = waitForEvent(
    daemon.client,
    (event) => event.type === 'run:status-changed' && event.phase === 'definition',
  );
  const run = await daemon.client.createRun({ prompt, cwd: repo.cwd });
  await planReady;
  await daemon.client.approveRun({ runId: run.runId });
  return run;
}

describe('correction and retry', () => {
  it('retries a task whose checks fail once, then completes once they pass', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        {
          id: 'TASK-001',
          title: 'Write marker file',
          // Not the POSIX `test -f` builtin: it doesn't exist as an executable on Windows, and
          // these checks are run directly via execa (no shell), so a bare `test` there just
          // fails with "command not found" instead of ever passing.
          checks: [
            {
              name: 'marker-exists',
              command: 'node',
              args: ['-e', "process.exit(require('fs').existsSync('marker.txt') ? 0 : 1)"],
            },
          ],
        },
      ],
    });
    runtime?.queueWorker('TASK-001', async () => {});
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'marker.txt'), 'ok', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    const run = await createAndApprove('Write a marker file');
    await runDone;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks[0]).toMatchObject({ status: 'done', retries: 1 });
    expect(plan?.tasksIndex.tasks[0]?.correctionFiles).toHaveLength(1);
    expect(runtime?.workerCallCount('TASK-001')).toBe(2);
  });

  it('marks a task as failed due to an infra issue without spending a worker correction retry', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        {
          id: 'TASK-001',
          title: 'Needs an unreachable registry',
          checks: [
            {
              name: 'network-check',
              command: 'node',
              args: [
                '-e',
                'console.error("getaddrinfo ENOTFOUND registry.invalid"); process.exit(1)',
              ],
            },
          ],
        },
      ],
    });
    runtime?.queueWorker('TASK-001', async () => {});

    const taskFailed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'failed',
      30000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Do something that needs an external registry');
    await taskFailed;
    await runBlocked;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    const task = plan?.tasksIndex.tasks[0];
    // retries stays at 0: an infra failure never burns the Worker's correction budget.
    expect(task).toMatchObject({ status: 'failed', retries: 0 });
    expect(task?.failureReason).toContain('infrastructure/environment issue');
    expect(task?.correctionFiles).toHaveLength(1);
    // The checks were retried on their own; the Worker itself was only ever dispatched once.
    expect(runtime?.workerCallCount('TASK-001')).toBe(1);
  });

  it('retries a task the Architect sends back for correction, then completes once approved', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Write greeting file' }],
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'greeting.txt'), 'hi', 'utf-8');
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'greeting.txt'), 'hello from ARCH\n', 'utf-8');
    });
    runtime?.queueReview('TASK-001', { correctionMarkdown: 'Use a friendlier greeting.' });
    runtime?.queueReview('TASK-001', 'approve');

    const run = await createAndApprove('Write a greeting file');
    const needsCorrection = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'needs_correction',
      30000,
    );
    await needsCorrection;

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    await runDone;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    const task = plan?.tasksIndex.tasks[0];
    expect(task).toMatchObject({ status: 'done', retries: 1 });
    expect(task?.correctionFiles).toHaveLength(1);
    expect(runtime?.workerCallCount('TASK-001')).toBe(2);
  });

  it("forwards the worker's own summary to the Architect's review prompt", async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Write greeting file' }],
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'greeting.txt'), 'hi', 'utf-8');
      return 'Wrote greeting.txt with a friendly hello message.';
    });
    runtime?.queueReview('TASK-001', 'approve');

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    await createAndApprove('Write a greeting file');
    await runDone;

    expect(runtime?.lastReviewPrompt('TASK-001')).toContain(
      'Wrote greeting.txt with a friendly hello message.',
    );
  });

  it('marks a task as failed once it exceeds maxRetries', async () => {
    await daemon.client.setConfig({ maxRetries: 0 });

    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        {
          id: 'TASK-001',
          title: 'Always fails',
          checks: [{ name: 'always-fails', command: 'false', args: [] }],
        },
      ],
    });
    runtime?.queueWorker('TASK-001', async () => {});

    const taskFailed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'failed',
      30000,
    );
    // The task-level 'failed' event fires before the run settles — worktree cleanup for
    // the failed task still runs afterward. Wait for the run to reach its terminal phase
    // too, or afterEach's repo.cleanup() can race that cleanup and remove the fixture repo
    // out from under an in-flight `git worktree remove`.
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Do something impossible');
    await taskFailed;
    await runBlocked;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    // retries stays at 0: with a budget of 0 correction rounds, the first failure is
    // already over budget, so it fails without ever being granted (and counted as) a retry.
    expect(plan?.tasksIndex.tasks[0]).toMatchObject({ status: 'failed', retries: 0 });
    expect(runtime?.workerCallCount('TASK-001')).toBe(1);
  });

  it('never lets the retries counter exceed maxRetries, however many times a task keeps failing', async () => {
    await daemon.client.setConfig({ maxRetries: 2 });

    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        {
          id: 'TASK-001',
          title: 'Always fails',
          checks: [{ name: 'always-fails', command: 'false', args: [] }],
        },
      ],
    });

    const taskFailed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'failed',
      30000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Do something impossible');
    await taskFailed;
    await runBlocked;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    // With a budget of 2 correction rounds, the task is dispatched 3 times total (1 initial
    // attempt + 2 retries) and retries caps at 2 — it must never read 3, the count it would
    // reach if the counter were incremented before checking the budget instead of after.
    expect(plan?.tasksIndex.tasks[0]).toMatchObject({ status: 'failed', retries: 2 });
    expect(runtime?.workerCallCount('TASK-001')).toBe(3);
  });
});

describe('human-driven retry', () => {
  it('continues in a dirty worktree left by a crashed worker instead of recreating its branch', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Finish a partially written file' }],
    });

    let originalWorktree = '';
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      originalWorktree = cwd;
      await writeFile(join(cwd, 'partial.txt'), 'first half\n', 'utf-8');
      throw new Error('worker crashed after writing partial output');
    });

    const taskFailed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'failed',
      30000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Finish a file even if the first worker crashes');
    await taskFailed;
    await runBlocked;

    await expect(readFile(join(originalWorktree, 'partial.txt'), 'utf-8')).resolves.toBe(
      'first half\n',
    );

    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      expect(cwd).toBe(originalWorktree);
      const partial = await readFile(join(cwd, 'partial.txt'), 'utf-8');
      await writeFile(join(cwd, 'partial.txt'), `${partial}second half\n`, 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    await daemon.client.retryTask({
      runId: run.runId,
      taskId: 'TASK-001',
      message: 'Continue from the partial work already present.',
    });
    await runDone;

    await expect(readFile(join(repo.cwd, 'partial.txt'), 'utf-8')).resolves.toBe(
      'first half\nsecond half\n',
    );
    expect(runtime?.workerCallCount('TASK-001')).toBe(2);
  });

  it('resumes a failed task with a human note and completes it, unblocking a cascade-blocked dependent', async () => {
    await daemon.client.setConfig({ maxRetries: 0 });

    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        {
          id: 'TASK-001',
          title: 'Write marker file',
          // Not the POSIX `test -f` builtin: it doesn't exist as an executable on Windows, and
          // these checks are run directly via execa (no shell), so a bare `test` there just
          // fails with "command not found" instead of ever passing.
          checks: [
            {
              name: 'marker-exists',
              command: 'node',
              args: ['-e', "process.exit(require('fs').existsSync('marker.txt') ? 0 : 1)"],
            },
          ],
        },
        { id: 'TASK-002', title: 'Write follow-up file', dependsOn: ['TASK-001'] },
      ],
    });
    runtime?.queueWorker('TASK-001', async () => {});

    const taskBlocked = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-002' &&
        event.status === 'blocked',
      30000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Write a marker file, then a follow-up file');
    await taskBlocked;
    await runBlocked;

    let capturedPrompt = '';
    runtime?.queueWorker('TASK-001', async ({ prompt, cwd }) => {
      capturedPrompt = prompt;
      await writeFile(join(cwd, 'marker.txt'), 'ok', 'utf-8');
    });
    runtime?.queueWorker('TASK-002', async ({ cwd }) => {
      await writeFile(join(cwd, 'followup.txt'), 'ok', 'utf-8');
    });

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    const promptSent = waitForEvent(
      daemon.client,
      (event) => event.type === 'human:prompt-sent' && event.taskId === 'TASK-001',
      30000,
    );
    const dispatchedViaHumanPrompt = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'agent:activity' &&
        event.taskId === 'TASK-001' &&
        event.state === 'thinking' &&
        event.viaHumanPrompt === true,
      30000,
    );
    await daemon.client.retryTask({
      runId: run.runId,
      taskId: 'TASK-001',
      message: 'Try writing the marker file with the v2 approach.',
    });
    const promptSentEvent = await promptSent;
    await dispatchedViaHumanPrompt;
    await runDone;

    expect(promptSentEvent).toMatchObject({
      type: 'human:prompt-sent',
      taskId: 'TASK-001',
      agentId: 'worker-TASK-001',
      text: 'Try writing the marker file with the v2 approach.',
    });
    expect(capturedPrompt).toContain('Try writing the marker file with the v2 approach.');

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    const [task1, task2] = plan?.tasksIndex.tasks ?? [];
    expect(task1).toMatchObject({
      id: 'TASK-001',
      status: 'done',
      retries: 0,
      correctionFiles: [],
    });
    expect(task1?.failureReason).toBeUndefined();
    expect(task2).toMatchObject({ id: 'TASK-002', status: 'done' });
    expect(runtime?.workerCallCount('TASK-001')).toBe(2);
    expect(runtime?.workerCallCount('TASK-002')).toBe(1);
  });

  it('lets a crash needing human intervention end in awaiting_human, not failed, and resolves via a later retry', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Write marker file' }],
    });
    runtime?.queueWorker('TASK-001', async () => {
      throw new Error("EACCES: permission denied, open '/etc/hosts'");
    });

    const taskAwaitingHuman = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'awaiting_human',
      30000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Write a marker file');
    await taskAwaitingHuman;
    await runBlocked;

    const planBefore = await daemon.client.getRunPlan({ runId: run.runId });
    expect(planBefore?.tasksIndex.tasks[0]).toMatchObject({
      status: 'awaiting_human',
      retries: 0,
    });
    expect(planBefore?.tasksIndex.tasks[0]?.failureReason).toContain('permission denied');

    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'marker.txt'), 'ok', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    await daemon.client.retryTask({
      runId: run.runId,
      taskId: 'TASK-001',
      message: 'The sandbox permissions have been fixed — please retry.',
    });
    await runDone;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks[0]).toMatchObject({ status: 'done', retries: 0 });
    expect(plan?.tasksIndex.tasks[0]?.failureReason).toBeUndefined();
    expect(runtime?.workerCallCount('TASK-001')).toBe(2);
  });
});

describe('retrying a task while a sibling is still in flight', () => {
  it('retries a failed task without waiting for its still-running sibling to finish', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        { id: 'TASK-001', title: 'Write file A', scope: ['a.txt'] },
        { id: 'TASK-002', title: 'Write file B', scope: ['b.txt'] },
      ],
    });
    runtime?.queueWorker('TASK-001', async () => {
      throw new Error('boom');
    });

    let releaseTask2: () => void = () => {};
    const task2Started = new Promise<void>((resolveStarted) => {
      runtime?.queueWorker('TASK-002', async ({ cwd }) => {
        resolveStarted();
        await new Promise<void>((resolveHold) => {
          releaseTask2 = resolveHold;
        });
        await writeFile(join(cwd, 'b.txt'), 'ok', 'utf-8');
      });
    });
    runtime?.queueReview('TASK-002', 'approve');

    const task1Failed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'failed',
      30000,
    );
    const run = await createAndApprove('Add two independent files');
    await task1Failed;
    await task2Started;

    // TASK-002 is still in flight, so the run is still 'implementation' — retrying TASK-001
    // must not depend on the whole run reaching 'blocked' first.
    const runWhileInFlight = await daemon.client.getRun({ runId: run.runId });
    expect(runWhileInFlight.phase).toBe('implementation');

    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'a.txt'), 'ok', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');

    await expect(
      daemon.client.retryTask({
        runId: run.runId,
        taskId: 'TASK-001',
        message: 'Please retry.',
      }),
    ).resolves.toMatchObject({ phase: 'implementation' });

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    releaseTask2();
    await runDone;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks.find((task) => task.id === 'TASK-001')).toMatchObject({
      status: 'done',
    });
    expect(plan?.tasksIndex.tasks.find((task) => task.id === 'TASK-002')).toMatchObject({
      status: 'done',
    });
    expect(runtime?.workerCallCount('TASK-001')).toBe(2);
    expect(runtime?.workerCallCount('TASK-002')).toBe(1);
  });
});

describe('done despite broken post-merge cleanup', () => {
  it('keeps an approved, merged task done even when worktree cleanup afterward fails', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Write output file' }],
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'output.txt'), 'ok', 'utf-8');
      // stageAll (run by dispatchWorker right after this handler returns) excludes `.arch`
      // from `git add -A`, so this file is never staged/committed — the worktree stays
      // dirty even after the task's own commit, and `git worktree remove` (no --force)
      // refuses to remove a dirty worktree. The merge itself still succeeds, so this
      // deterministically reproduces "merged OK, post-merge cleanup fails".
      await mkdir(join(cwd, '.arch'), { recursive: true });
      await writeFile(join(cwd, '.arch', 'leftover.txt'), 'dirty', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    const run = await createAndApprove('Write an output file');
    await runDone;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks[0]).toMatchObject({ status: 'done', retries: 0 });
    expect(plan?.tasksIndex.tasks[0]?.failureReason).toBeUndefined();
  });
});

describe('crash cleanup and console visibility (useWorktrees: false)', () => {
  it("reverts a crashed worker's leftover files and surfaces the crash as its failure reason, without contaminating a sibling task", async () => {
    await daemon.client.setConfig({ useWorktrees: false, maxConcurrency: 1 });

    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        { id: 'TASK-A', title: 'Crashes mid-execution' },
        { id: 'TASK-B', title: 'Unrelated task', scope: ['b.txt'] },
      ],
    });
    runtime?.queueWorker('TASK-A', async ({ cwd }) => {
      await writeFile(join(cwd, 'partial.txt'), 'partial\n', 'utf-8');
      throw new Error('worker aborted mid-stream (exit code 143)');
    });
    runtime?.queueWorker('TASK-B', async ({ cwd }) => {
      await writeFile(join(cwd, 'b.txt'), 'TASK-B\n', 'utf-8');
    });
    runtime?.queueReview('TASK-B', 'approve');

    const workerMessages: string[] = [];
    const unsubscribe = daemon.client.onEvent((event) => {
      if (event.type === 'agent:message' && event.taskId === 'TASK-A') {
        workerMessages.push(event.text);
      }
    });

    const taskFailed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-A' &&
        event.status === 'failed',
      30000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Do two unrelated things');
    const taskFailedEvent = await taskFailed;
    await runBlocked;

    expect(taskFailedEvent).toMatchObject({
      type: 'task:status-changed',
      taskId: 'TASK-A',
      status: 'failed',
      failureReason: expect.stringContaining('aborted mid-stream'),
    });

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    const taskA = plan?.tasksIndex.tasks.find((task) => task.id === 'TASK-A');
    expect(taskA).toMatchObject({ status: 'failed' });
    expect(taskA?.failureReason).toContain('aborted mid-stream');

    const taskB = plan?.tasksIndex.tasks.find((task) => task.id === 'TASK-B');
    // Without the fix, `partial.txt` stays dirty in the shared repo forever and gets
    // misattributed as one of TASK-B's own out-of-scope changes on its first dispatch.
    expect(taskB).toMatchObject({ status: 'done', retries: 0 });

    // The crash text must surface exactly once, as the task-status failureReason above — not a
    // second time as a plain agent:message, which the Console would otherwise render twice.
    unsubscribe();
    expect(workerMessages).toEqual([]);

    await expect(access(join(repo.cwd, 'partial.txt'))).rejects.toThrow();
    await expect(readFile(join(repo.cwd, 'b.txt'), 'utf-8')).resolves.toBe('TASK-B\n');
  });
});

describe('implementation-loop recovery when a crashed task cannot even revert its own files', () => {
  it('still reaches phase "blocked" and releases the abort controller, instead of leaving the run stuck forever', async () => {
    await daemon.client.setConfig({ useWorktrees: false, maxConcurrency: 1 });

    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Crashes mid-execution, taking git down with it' }],
    });
    // Mirrors the real incident: the worker crashes, and the repo it was working in is no
    // longer a git repository by the time the cleanup path tries `git status` on it — so
    // revertOwnFiles() itself throws. Before the fix, that second failure escaped
    // runTlTaskCycle's catch uncaught, crashed the whole implementation-phase loop, and left
    // the RunManager believing the loop was still alive forever.
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'partial.txt'), 'partial\n', 'utf-8');
      await rm(join(cwd, '.git'), { recursive: true, force: true });
      throw new Error('worker aborted mid-stream (exit code 143)');
    });

    const taskFailed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'failed',
      30000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Do one thing that will crash');
    await taskFailed;
    await runBlocked;

    const refreshed = await daemon.client.getRun({ runId: run.runId });
    expect(refreshed.phase).toBe('blocked');

    // The abort controller must have been released alongside the phase flip — otherwise a
    // human message sent via retryTask would be queued for a loop that no longer exists and
    // silently lost forever. abortRun only succeeds while a controller is registered.
    await expect(daemon.client.abortRun({ runId: run.runId })).rejects.toThrow(
      /has no active work to abort/,
    );
  });
});

describe('automatic api-error retry', () => {
  it('retries a worker dispatch Claude rejected before execution, without counting it as a correction retry', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Write greeting file' }],
    });
    runtime?.queueWorker('TASK-001', async () => {
      throw new ClaudeApiRejectionError(400, 'transient rejection 1');
    });
    runtime?.queueWorker('TASK-001', async () => {
      throw new ClaudeApiRejectionError(400, 'transient rejection 2');
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'greeting.txt'), 'hello from ARCH\n', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    const run = await createAndApprove('Write a greeting file');
    await runDone;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks[0]).toMatchObject({ status: 'done', retries: 0 });
    expect(runtime?.workerCallCount('TASK-001')).toBe(3);
  });

  it('marks a task as failed once the api-error retry budget is exhausted', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Write greeting file' }],
    });
    // Queue more rejections than the retry budget allows, to confirm the cap is enforced
    // rather than merely reached: only 4 (1 initial + 3 retries) should ever be consumed.
    for (let i = 0; i < 5; i += 1) {
      runtime?.queueWorker('TASK-001', async () => {
        throw new ClaudeApiRejectionError(400, 'persistent rejection');
      });
    }

    const taskFailed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'failed',
      30000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Write a greeting file');
    await taskFailed;
    await runBlocked;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks[0]).toMatchObject({ status: 'failed', retries: 0 });
    expect(plan?.tasksIndex.tasks[0]?.failureReason).toContain('persistent rejection');
    expect(runtime?.workerCallCount('TASK-001')).toBe(4);
  });
});

describe('automatic Codex-timeout retry', () => {
  it('continues partial work after a timeout without failing the task or spending a correction retry', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Write greeting file' }],
    });

    let originalWorktree = '';
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      originalWorktree = cwd;
      await writeFile(join(cwd, 'greeting.txt'), 'hello', 'utf-8');
      throw new CodexTimeoutError(30 * 60_000);
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      expect(cwd).toBe(originalWorktree);
      const partial = await readFile(join(cwd, 'greeting.txt'), 'utf-8');
      await writeFile(join(cwd, 'greeting.txt'), `${partial} from ARCH\n`, 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    const run = await createAndApprove('Write a greeting file');
    await runDone;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks[0]).toMatchObject({ status: 'done', retries: 0 });
    expect(runtime?.workerCallCount('TASK-001')).toBe(2);
    await expect(readFile(join(repo.cwd, 'greeting.txt'), 'utf-8')).resolves.toBe(
      'hello from ARCH\n',
    );
  });
});

describe('automatic stream-abort retry', () => {
  it('retries in the same worktree after a CLI interruption, preserving partial work without counting a correction retry', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Write greeting file' }],
    });
    let originalWorktree = '';
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      originalWorktree = cwd;
      await writeFile(join(cwd, 'greeting.txt'), 'hello', 'utf-8');
      throw new ClaudeStreamAbortedError('aborted_streaming', 0.42, 15);
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      expect(cwd).toBe(originalWorktree);
      const partial = await readFile(join(cwd, 'greeting.txt'), 'utf-8');
      await writeFile(join(cwd, 'greeting.txt'), `${partial} from ARCH\n`, 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    const run = await createAndApprove('Write a greeting file');
    await runDone;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks[0]).toMatchObject({ status: 'done', retries: 0 });
    expect(runtime?.workerCallCount('TASK-001')).toBe(2);
    await expect(readFile(join(repo.cwd, 'greeting.txt'), 'utf-8')).resolves.toBe(
      'hello from ARCH\n',
    );
  });

  it('marks a task as failed with a short failure reason once the stream-abort retry budget is exhausted', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Write greeting file' }],
    });
    // Queue more aborts than the retry budget allows, to confirm the cap is enforced rather
    // than merely reached: only 4 (1 initial + 3 retries) should ever be consumed.
    for (let i = 0; i < 5; i += 1) {
      runtime?.queueWorker('TASK-001', async () => {
        throw new ClaudeStreamAbortedError('aborted_streaming', 0.42, 15);
      });
    }

    const taskFailed = waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'task:status-changed' &&
        event.taskId === 'TASK-001' &&
        event.status === 'failed',
      30000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Write a greeting file');
    await taskFailed;
    await runBlocked;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    const failedTask = plan?.tasksIndex.tasks[0];
    expect(failedTask).toMatchObject({ status: 'failed', retries: 0 });
    // The user's original complaint: the failure log must be short and descriptive, never the
    // raw execa wall-of-text (which would embed the entire multi-thousand-character worker
    // prompt passed as the CLI's `-p` argument).
    expect(failedTask?.failureReason?.split('\n').length).toBeLessThanOrEqual(2);
    expect(runtime?.workerCallCount('TASK-001')).toBe(4);
  });
});

describe('architect review crash', () => {
  // Regression test for a real production incident: when the Architect's review call itself
  // crashes (e.g. a spawn-time failure, ENAMETOOLONG for an oversized prompt), the daemon used
  // to discard the real error and surface only a generic "Architect review failed for task X" —
  // giving a human staring at the failed task no way to tell what actually happened without
  // going to read daemon.log by hand. The real error must now reach the task's failureReason.
  it("surfaces the real crash reason in the task's failureReason instead of a generic message", async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [{ id: 'TASK-001', title: 'Write greeting file' }],
    });
    runtime?.queueWorker('TASK-001', async () => {});
    runtime?.queueReview('TASK-001', { crash: 'ENAMETOOLONG: prompt too large for argv' });

    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      30000,
    );
    const run = await createAndApprove('Write a greeting file');
    await runBlocked;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    const failedTask = plan?.tasksIndex.tasks[0];
    expect(failedTask?.status).toBe('failed');
    expect(failedTask?.failureReason).toContain('ENAMETOOLONG: prompt too large for argv');
  });
});
