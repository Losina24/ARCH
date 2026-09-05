import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunHeadlessOptions, RunHeadlessResult } from '@losina/claude-runtime';
import type { AgentMessageEvent } from '@losina/ipc';
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

describe('happy path', () => {
  it('runs a single task from creation to done and merges the change into the repo', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief\n\nAdd a greeting file.',
      tasks: [{ id: 'TASK-001', title: 'Add greeting file' }],
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'greeting.txt'), 'hello from ARCH\n', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({ prompt: 'Add a greeting file', cwd: repo.cwd });
    expect(run.phase).toBe('grilling');
    await planReady;

    const plan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(plan?.tasksIndex.tasks).toHaveLength(1);
    expect(plan?.projectMarkdown).toContain('Add a greeting file');

    const messageEvents: AgentMessageEvent[] = [];
    const unsubscribeMessages = daemon.client.onEvent((event) => {
      if (event.type === 'agent:message') messageEvents.push(event);
    });

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
    const approved = await daemon.client.approveRun({ runId: run.runId });
    expect(approved.phase).toBe('implementation');
    await runDone;
    unsubscribeMessages();

    const finalRun = await daemon.client.getRun({ runId: run.runId });
    expect(finalRun.phase).toBe('done');

    const workerMessage = messageEvents.find((event) => event.role === 'worker');
    expect(workerMessage).toMatchObject({ taskId: 'TASK-001', text: 'done' });

    const architectMessage = messageEvents.find((event) => event.role === 'architect');
    expect(architectMessage).toMatchObject({
      taskId: 'TASK-001',
      text: 'Approved — no corrections requested.',
    });

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(finalPlan?.tasksIndex.tasks[0]).toMatchObject({ id: 'TASK-001', status: 'done' });

    await expect(readFile(join(repo.cwd, 'greeting.txt'), 'utf-8')).resolves.toBe(
      'hello from ARCH\n',
    );

    const log = await execa('git', ['log', '--oneline'], { cwd: repo.cwd });
    expect(log.stdout).toContain('TASK-001');
  });

  it('runs independent tasks and a dependent task that waits for them', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief\n\nAdd two files, then a third that depends on both.',
      tasks: [
        { id: 'TASK-A', title: 'Write file A', scope: ['TASK-A.txt'] },
        { id: 'TASK-B', title: 'Write file B' },
        { id: 'TASK-C', title: 'Write file C', dependsOn: ['TASK-A', 'TASK-B'] },
      ],
    });
    for (const id of ['TASK-A', 'TASK-B', 'TASK-C']) {
      runtime?.queueWorker(id, async ({ cwd }) => {
        await writeFile(join(cwd, `${id}.txt`), `${id}\n`, 'utf-8');
      });
      runtime?.queueReview(id, 'approve');
    }

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({ prompt: 'Add three files', cwd: repo.cwd });
    await planReady;

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    await runDone;

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    for (const id of ['TASK-A', 'TASK-B', 'TASK-C']) {
      expect(finalPlan?.tasksIndex.tasks.find((task) => task.id === id)).toMatchObject({
        status: 'done',
      });
      await expect(readFile(join(repo.cwd, `${id}.txt`), 'utf-8')).resolves.toBe(`${id}\n`);
    }

    // TASK-C depends on both TASK-A and TASK-B — its Worker prompt must actually name them as a
    // fixed contract to build on, not leave it to discover them (or worse, redefine them) blind.
    const workerPrompt = runtime?.lastWorkerPrompt('TASK-C');
    expect(workerPrompt).toContain('TASK-A');
    expect(workerPrompt).toContain('Write file A');
    expect(workerPrompt).toContain('TASK-A.txt');
    expect(workerPrompt).toContain('TASK-B');
    expect(workerPrompt).toContain('Write file B');

    // Its review must also warn the Architect that TASK-A.txt is owned by a dependency, not by
    // TASK-C itself — confirms dependencyScopes threads all the way through the review request.
    const reviewPrompt = runtime?.lastReviewPrompt('TASK-C');
    expect(reviewPrompt).toContain('TASK-A.txt');
  });
});
