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
});

afterEach(async () => {
  await daemon.stop();
  await repo.cleanup();
  runtime = undefined;
});

describe('contract-first sequencing', () => {
  // Regression test for the gap where an approved contract task committed to its own
  // feat/<id> branch, but ARCH deliberately never merges/deletes that branch when the run's
  // base branch is the protected "develop" branch (see PROTECTED_BRANCH in tl-loop.ts) — so a
  // dependent task's fresh worktree, branching from repoRoot's HEAD, would otherwise never
  // receive the contract at all, no matter how well the Architect sequenced the plan.
  it("still lands a dependency's contract in a consumer's worktree when the base branch is develop", async () => {
    await execa('git', ['checkout', '-b', 'develop'], { cwd: repo.cwd });
    daemon = await startDaemonHarness(repo.cwd);

    runtime?.queuePlan({
      projectMarkdown: '# Brief\n\nDefine a shared contract, then consume it.',
      tasks: [
        { id: 'TASK-A', title: 'Define the shared contract', scope: ['contract.ts'] },
        { id: 'TASK-B', title: 'Consume the contract', dependsOn: ['TASK-A'] },
      ],
    });
    runtime?.queueWorker('TASK-A', async ({ cwd }) => {
      await writeFile(join(cwd, 'contract.ts'), 'export type Job = { id: string };\n', 'utf-8');
    });
    runtime?.queueReview('TASK-A', 'approve');
    runtime?.queueWorker('TASK-B', async ({ cwd }) => {
      // Reads TASK-A's own contract file from TASK-B's own worktree — if it isn't physically
      // present there, this throws and the task never reaches 'done' below, which is exactly
      // the failure mode this test guards against. Returning its content as the summary lets
      // the assertions below confirm the real file was read, not just that nothing crashed.
      const contract = await readFile(join(cwd, 'contract.ts'), 'utf-8');
      return `Consumed contract: ${contract.trim()}`;
    });
    runtime?.queueReview('TASK-B', 'approve');

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({
      prompt: 'Define and consume a contract',
      cwd: repo.cwd,
    });
    await planReady;

    const messageEvents: AgentMessageEvent[] = [];
    const unsubscribeMessages = daemon.client.onEvent((event) => {
      if (event.type === 'agent:message') messageEvents.push(event);
    });

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    await runDone;
    unsubscribeMessages();

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(finalPlan?.tasksIndex.tasks.find((task) => task.id === 'TASK-A')).toMatchObject({
      status: 'done',
    });
    expect(finalPlan?.tasksIndex.tasks.find((task) => task.id === 'TASK-B')).toMatchObject({
      status: 'done',
    });

    // TASK-A's own branch was deliberately left unmerged (base branch is develop) — confirms
    // this test actually exercises the gap, not some other path that happens to also pass.
    const branches = await execa('git', ['branch', '--list', 'feat/TASK-A'], { cwd: repo.cwd });
    expect(branches.stdout.trim()).not.toBe('');

    const taskBMessage = messageEvents.find(
      (event) => event.role === 'worker' && event.taskId === 'TASK-B',
    );
    expect(taskBMessage?.text).toBe('Consumed contract: export type Job = { id: string };');
  });
});
