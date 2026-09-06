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

function waitForChatReply() {
  return waitForEvent(
    daemon.client,
    (event) => event.type === 'agent:message' && event.role === 'architect' && !event.taskId,
    15000,
  );
}

describe('chatting with the Architect', () => {
  it('answers while a task is still running, resuming the same session on the next message', async () => {
    runtime?.queuePlan({ projectMarkdown: '# Brief', tasks: [{ id: 'TASK-001', title: 'Do work' }] });

    let releaseWorker: () => void = () => {};
    const workerGate = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });
    runtime?.queueWorker('TASK-001', async () => {
      await workerGate;
    });
    runtime?.queueReview('TASK-001', 'approve');
    runtime?.queueChatReply('Working on TASK-001 right now.');
    runtime?.queueChatReply('Still on it.');

    try {
      const taskInProgress = waitForEvent(
        daemon.client,
        (event) =>
          event.type === 'task:status-changed' &&
          event.taskId === 'TASK-001' &&
          event.status === 'in_progress',
        15000,
      );
      const run = await createAndApprove('Do some work');
      // Otherwise the very first chat call can race runImplementationPhase's own startup (the
      // implementation loop registers its bus, and its own chatSessionId, only once it actually
      // starts) and get routed through the one-shot path instead of the live one this test means
      // to exercise — waiting for the task to actually be dispatched rules that race out.
      await taskInProgress;

      const firstReply = waitForChatReply();
      await daemon.client.chatWithArchitect({ runId: run.runId, message: 'How is it going?' });
      const firstEvent = await firstReply;
      if (firstEvent.type !== 'agent:message') throw new Error('unreachable');
      expect(firstEvent.text).toBe('Working on TASK-001 right now.');
      expect(runtime?.chatResumeSessionIdAt(0)).toBeUndefined();

      const secondReply = waitForChatReply();
      await daemon.client.chatWithArchitect({ runId: run.runId, message: 'And now?' });
      const secondEvent = await secondReply;
      if (secondEvent.type !== 'agent:message') throw new Error('unreachable');
      expect(secondEvent.text).toBe('Still on it.');

      // The whole point of chatSessionId: the second call resumes the exact session the first one
      // returned, unlike review/consultation which deliberately never resume.
      expect(runtime?.chatResumeSessionIdAt(1)).toBe(runtime?.chatSessionIdAt(0));
      expect(runtime?.chatCallCount()).toBe(2);
      expect(runtime?.lastChatPrompt()).toContain('And now?');
    } finally {
      releaseWorker();
    }
    await waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
  });

  it('answers a one-shot chat message once the run is blocked, without a live Architect loop', async () => {
    await daemon.client.setConfig({ maxRetries: 0 });
    runtime?.queuePlan({
      projectMarkdown: '# Brief',
      tasks: [
        {
          id: 'TASK-001',
          title: 'Always fails',
          checks: [{ name: 'always-fails', command: 'node', args: ['-e', 'process.exit(1)'] }],
        },
      ],
    });
    runtime?.queueWorker('TASK-001', async () => {});
    runtime?.queueChatReply('This run is blocked on TASK-001.');

    const run = await createAndApprove('Write something that always fails its check');
    await waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'blocked',
      15000,
    );

    const reply = waitForChatReply();
    await daemon.client.chatWithArchitect({ runId: run.runId, message: 'What happened?' });
    const event = await reply;
    if (event.type !== 'agent:message') throw new Error('unreachable');
    expect(event.text).toBe('This run is blocked on TASK-001.');
    expect(runtime?.lastChatPrompt()).toContain('What happened?');
  });

  it('answers a one-shot chat message once the run is done', async () => {
    runtime?.queuePlan({ projectMarkdown: '# Brief', tasks: [{ id: 'TASK-001', title: 'Do work' }] });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'marker.txt'), 'ok', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');
    runtime?.queueChatReply('Everything finished successfully.');

    const run = await createAndApprove('Write a marker file');
    await waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );

    const reply = waitForChatReply();
    await daemon.client.chatWithArchitect({ runId: run.runId, message: 'How did it go?' });
    const event = await reply;
    if (event.type !== 'agent:message') throw new Error('unreachable');
    expect(event.text).toBe('Everything finished successfully.');
  });

  function waitForFollowUpRunAnnouncement() {
    return waitForEvent(
      daemon.client,
      (event) =>
        event.type === 'agent:message' &&
        event.role === 'architect' &&
        !event.taskId &&
        event.text.startsWith('Started a new run for that:'),
      15000,
    );
  }

  it('starts a brand-new run when a chat message during implementation asks for real project work', async () => {
    runtime?.queuePlan({ projectMarkdown: '# Brief', tasks: [{ id: 'TASK-001', title: 'Do work' }] });
    // Consumed once the follow-up run reaches its own Definition phase.
    runtime?.queuePlan({
      projectMarkdown: '# Follow-up brief',
      tasks: [{ id: 'TASK-001', title: 'Add subtract()' }],
    });

    let releaseWorker: () => void = () => {};
    const workerGate = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });
    runtime?.queueWorker('TASK-001', async () => {
      await workerGate;
    });
    runtime?.queueReview('TASK-001', 'approve');
    runtime?.queueChatRunRequest(
      'Add a subtract(a, b) function too.',
      "Sure, I've started a new run for that.",
    );

    try {
      const taskInProgress = waitForEvent(
        daemon.client,
        (event) =>
          event.type === 'task:status-changed' &&
          event.taskId === 'TASK-001' &&
          event.status === 'in_progress',
        15000,
      );
      const run = await createAndApprove('Do some work');
      await taskInProgress;

      const announcement = waitForFollowUpRunAnnouncement();
      await daemon.client.chatWithArchitect({
        runId: run.runId,
        message: 'Also add a subtract function please',
      });
      await announcement;

      const runs = await daemon.client.listRuns();
      const newRun = runs.find((candidate) => candidate.runId !== run.runId);
      expect(newRun).toBeTruthy();
      expect(newRun?.prompt).toBe('Add a subtract(a, b) function too.');
      expect(newRun?.cwd).toBe(repo.cwd);
    } finally {
      releaseWorker();
    }
    await waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
  });

  it('starts a brand-new run when a one-shot chat message (run already done) asks for real project work', async () => {
    runtime?.queuePlan({ projectMarkdown: '# Brief', tasks: [{ id: 'TASK-001', title: 'Do work' }] });
    runtime?.queuePlan({
      projectMarkdown: '# Follow-up brief',
      tasks: [{ id: 'TASK-001', title: 'Add health check' }],
    });
    runtime?.queueWorker('TASK-001', async ({ cwd }) => {
      await writeFile(join(cwd, 'marker.txt'), 'ok', 'utf-8');
    });
    runtime?.queueReview('TASK-001', 'approve');
    runtime?.queueChatRunRequest(
      'Add a health-check endpoint.',
      'Done — starting a new run for that.',
    );

    const run = await createAndApprove('Write a marker file');
    await waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );

    const announcement = waitForFollowUpRunAnnouncement();
    await daemon.client.chatWithArchitect({
      runId: run.runId,
      message: 'Can you add a health-check endpoint?',
    });
    await announcement;

    const runs = await daemon.client.listRuns();
    const newRun = runs.find((candidate) => candidate.runId !== run.runId);
    expect(newRun).toBeTruthy();
    expect(newRun?.prompt).toBe('Add a health-check endpoint.');
    expect(newRun?.cwd).toBe(repo.cwd);
  });
});
