import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunHeadlessOptions, RunHeadlessResult } from '@losina/claude-runtime';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DaemonHarness, startDaemonHarness } from './support/daemon-harness.js';
import { FakeClaudeRuntime } from './support/fake-claude-runtime.js';
import { type MultiRepoFixture, createMultiRepoFixture } from './support/repo-fixture.js';
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

let repos: MultiRepoFixture;
let daemon: DaemonHarness;

beforeEach(async () => {
  runtime = new FakeClaudeRuntime();
  repos = await createMultiRepoFixture();
  daemon = await startDaemonHarness(repos.cwd);
});

afterEach(async () => {
  await daemon.stop();
  await repos.cleanup();
  runtime = undefined;
});

describe('multi-repo run (cwd is a container of several sibling repositories)', () => {
  it('runs each task in the repo its own repoRoot points to, and merges the change there', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief\n\nAdd a file to service-a and another to service-b.',
      tasks: [
        { id: 'TASK-A', title: 'Add file to service-a', repoRoot: repos.repoA },
        { id: 'TASK-B', title: 'Add file to service-b', repoRoot: repos.repoB },
      ],
    });
    runtime?.queueWorker('TASK-A', async ({ cwd }) => {
      await writeFile(join(cwd, 'a.txt'), 'from task A\n', 'utf-8');
    });
    runtime?.queueWorker('TASK-B', async ({ cwd }) => {
      await writeFile(join(cwd, 'b.txt'), 'from task B\n', 'utf-8');
    });
    runtime?.queueReview('TASK-A', 'approve');
    runtime?.queueReview('TASK-B', 'approve');

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({
      prompt: 'Add a file to each service',
      cwd: repos.cwd,
    });
    await planReady;

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      15000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    await runDone;

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(finalPlan?.tasksIndex.tasks.find((task) => task.id === 'TASK-A')).toMatchObject({
      status: 'done',
    });
    expect(finalPlan?.tasksIndex.tasks.find((task) => task.id === 'TASK-B')).toMatchObject({
      status: 'done',
    });

    await expect(readFile(join(repos.repoA, 'a.txt'), 'utf-8')).resolves.toBe('from task A\n');
    await expect(readFile(join(repos.repoB, 'b.txt'), 'utf-8')).resolves.toBe('from task B\n');

    // Each task's change must land only in its own repo, never bleed into the other one.
    await expect(readFile(join(repos.repoB, 'a.txt'), 'utf-8')).rejects.toThrow();
    await expect(readFile(join(repos.repoA, 'b.txt'), 'utf-8')).rejects.toThrow();

    const logA = await execa('git', ['log', '--oneline'], { cwd: repos.repoA });
    expect(logA.stdout).toContain('TASK-A');
    const logB = await execa('git', ['log', '--oneline'], { cwd: repos.repoB });
    expect(logB.stdout).toContain('TASK-B');
  });
});
