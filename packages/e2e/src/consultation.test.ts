import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

function queueAlwaysFailingTask() {
  runtime?.queuePlan({
    projectMarkdown: '# Brief',
    tasks: [
      {
        id: 'TASK-001',
        title: 'Write marker file',
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
}

describe('architect consultation on a stuck task', () => {
  it('asks the Architect exactly once, after the task is already failed, and relays the human reply verbatim to the Worker', async () => {
    await daemon.client.setConfig({ maxRetries: 0 });
    queueAlwaysFailingTask();
    runtime?.queueWorker('TASK-001', async () => {});
    runtime?.queueConsultation('TASK-001', {
      question:
        'The check expects marker.txt at the repo root — should the worker create it there or under dist/?',
      recommendation: 'Create marker.txt at the repository root.',
    });

    const questionAsked = waitForEvent(
      daemon.client,
      (event) => event.type === 'consultation:question-asked' && event.taskId === 'TASK-001',
      15000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      15000,
    );
    const run = await createAndApprove('Write a marker file');
    const question = await questionAsked;
    await runBlocked;

    if (question.type !== 'consultation:question-asked') throw new Error('unreachable');
    expect(question.question).toContain('marker.txt');
    expect(question.recommendation).toBe('Create marker.txt at the repository root.');
    expect(question.failureReason).toBeTruthy();
    expect(runtime?.consultationCallCount('TASK-001')).toBe(1);
    expect(runtime?.lastConsultationPrompt('TASK-001')).toContain('marker-exists');
    expect(runtime?.lastConsultationPrompt('TASK-001')).toContain('checks, after 0/0');

    // Ordering invariant: the task was already `failed` (and its worktree already released)
    // before the question reached the human — see escalateToHuman's own doc comment for why
    // this order is load-bearing. Event persistence is fire-and-forget relative to the live
    // broadcast both `questionAsked` and `runBlocked` above resolved from, so poll rather than
    // assume the write has already landed by the time this runs.
    const events = await vi.waitFor(async () => {
      const loaded = await daemon.client.getRunEvents({ runId: run.runId });
      expect(loaded.some((entry) => entry.event.type === 'consultation:question-asked')).toBe(true);
      return loaded;
    });
    const failedIndex = events.findIndex(
      (entry) =>
        entry.event.type === 'task:status-changed' &&
        entry.event.taskId === 'TASK-001' &&
        entry.event.status === 'failed',
    );
    const questionIndex = events.findIndex(
      (entry) => entry.event.type === 'consultation:question-asked',
    );
    expect(failedIndex).toBeGreaterThan(-1);
    expect(questionIndex).toBeGreaterThan(failedIndex);

    // The human's reply goes straight to the Worker, verbatim, with no second Architect call.
    let capturedPrompt = '';
    runtime?.queueWorker('TASK-001', async ({ prompt, cwd }) => {
      capturedPrompt = prompt;
      await writeFile(join(cwd, 'marker.txt'), 'ok', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');
    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
    await daemon.client.retryTask({
      runId: run.runId,
      taskId: 'TASK-001',
      message: question.recommendation,
    });
    await runDone;

    expect(capturedPrompt).toContain('Create marker.txt at the repository root.');
    expect(capturedPrompt).toContain('A human reviewed this task after a previous attempt');
    expect(runtime?.consultationCallCount('TASK-001')).toBe(1);
    expect(runtime?.workerCallCount('TASK-001')).toBe(2);
  });

  it('also fires for a crash that needs human intervention, without changing its awaiting_human outcome', async () => {
    queueAlwaysFailingTask();
    runtime?.queueWorker('TASK-001', async () => {
      throw new Error('EACCES: permission denied, this needs human approval');
    });
    runtime?.queueConsultation('TASK-001', {
      question: 'The worker hit a permissions wall — do you want to grant it access?',
      recommendation: 'Grant the requested permission and retry.',
    });

    const questionAsked = waitForEvent(
      daemon.client,
      (event) => event.type === 'consultation:question-asked' && event.taskId === 'TASK-001',
      15000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      15000,
    );
    const run = await createAndApprove('Do something that needs permission');
    await questionAsked;
    await runBlocked;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks[0]?.status).toBe('awaiting_human');
  });

  it('never changes the task outcome when the consultation itself crashes', async () => {
    await daemon.client.setConfig({ maxRetries: 0 });
    queueAlwaysFailingTask();
    runtime?.queueWorker('TASK-001', async () => {});
    runtime?.queueConsultation('TASK-001', { crash: 'the architect blew up' });

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
    const run = await createAndApprove('Write a marker file');
    const failedEvent = await taskFailed;
    await runBlocked;

    if (failedEvent.type !== 'task:status-changed') throw new Error('unreachable');
    expect(failedEvent.failureReason).toBeTruthy();

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks[0]).toMatchObject({ status: 'failed' });

    // The task is still perfectly retryable — a broken consultation is not a broken task.
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'marker.txt'), 'ok', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');
    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
    await daemon.client.retryTask({ runId: run.runId, taskId: 'TASK-001', message: 'try again' });
    await runDone;
  });

  it('lets the human dismiss the question without touching the task, still retryable afterward', async () => {
    await daemon.client.setConfig({ maxRetries: 0 });
    queueAlwaysFailingTask();
    runtime?.queueWorker('TASK-001', async () => {});
    runtime?.queueConsultation('TASK-001', {
      question: 'Should the worker create marker.txt at the root?',
      recommendation: 'Create marker.txt at the repository root.',
    });

    const questionAsked = waitForEvent(
      daemon.client,
      (event) => event.type === 'consultation:question-asked' && event.taskId === 'TASK-001',
      15000,
    );
    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      15000,
    );
    const run = await createAndApprove('Write a marker file');
    await questionAsked;
    await runBlocked;

    const answered = waitForEvent(
      daemon.client,
      (event) => event.type === 'consultation:answered' && event.taskId === 'TASK-001',
    );
    await daemon.client.dismissConsultation({ runId: run.runId, taskId: 'TASK-001' });
    const answeredEvent = await answered;
    if (answeredEvent.type !== 'consultation:answered') throw new Error('unreachable');
    expect(answeredEvent.skipped).toBe(true);

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks[0]?.status).toBe('failed');

    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'marker.txt'), 'ok', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');
    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
    await daemon.client.retryTask({ runId: run.runId, taskId: 'TASK-001', message: 'try again' });
    await runDone;
  });

  it('replays exactly one consultation:question-asked event for a client that mounts after the run is already blocked', async () => {
    await daemon.client.setConfig({ maxRetries: 0 });
    queueAlwaysFailingTask();
    runtime?.queueWorker('TASK-001', async () => {});
    runtime?.queueConsultation('TASK-001', {
      question: 'Should the worker create marker.txt at the root?',
      recommendation: 'Create marker.txt at the repository root.',
    });

    const runBlocked = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      15000,
    );
    const run = await createAndApprove('Write a marker file');
    await runBlocked;

    // Persistence is fire-and-forget relative to the live run:status-changed broadcast this
    // just waited on, so poll rather than assume the write has already landed.
    await vi.waitFor(async () => {
      const events = await daemon.client.getRunEvents({ runId: run.runId });
      const questionEvents = events.filter(
        (entry) => entry.event.type === 'consultation:question-asked',
      );
      expect(questionEvents).toHaveLength(1);
    });
  });
});
