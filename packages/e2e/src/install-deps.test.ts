import { mkdir, writeFile } from 'node:fs/promises';
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

  // Commit a package.json + package-lock.json that depends on a local (file:) package, so a
  // fresh `git worktree add` checks both out but never inherits node_modules — proving that any
  // check requiring the dependency only passes if installWorktreeDependencies actually ran
  // first. The file: dependency keeps `npm ci` fully offline, so the test needs no network.
  await mkdir(join(repo.cwd, 'local-dep'), { recursive: true });
  await writeFile(
    join(repo.cwd, 'local-dep', 'package.json'),
    JSON.stringify({ name: 'local-dep', version: '1.0.0', main: 'index.js' }),
    'utf-8',
  );
  await writeFile(
    join(repo.cwd, 'local-dep', 'index.js'),
    "module.exports = 'installed';\n",
    'utf-8',
  );
  await writeFile(
    join(repo.cwd, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      dependencies: { 'local-dep': 'file:./local-dep' },
    }),
    'utf-8',
  );
  await execa('npm', ['install', '--package-lock-only', '--offline'], { cwd: repo.cwd });
  await execa('git', ['add', '-A'], { cwd: repo.cwd });
  await execa('git', ['commit', '-m', 'chore: add local-dep fixture'], { cwd: repo.cwd });

  daemon = await startDaemonHarness(repo.cwd);
});

afterEach(async () => {
  await daemon.stop();
  await repo.cleanup();
  runtime = undefined;
});

describe('worktree dependency install', () => {
  it('installs dependencies in a fresh worktree before running a check that needs them', async () => {
    runtime?.queuePlan({
      projectMarkdown: '# Brief\n\nA task whose only check needs an installed dependency.',
      tasks: [
        {
          id: 'TASK-001',
          title: 'Needs node_modules',
          checks: [
            {
              name: 'local-dep-resolves',
              command: 'node',
              args: ['-e', "require('./node_modules/local-dep')"],
            },
          ],
        },
      ],
    });
    runtime?.queueWorker('TASK-001', () => 'done');
    runtime?.queueReview('TASK-001', 'approve');

    const planReady = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'definition',
    );
    const run = await daemon.client.createRun({ prompt: 'Needs node_modules', cwd: repo.cwd });
    await planReady;

    const runDone = waitForEvent(
      daemon.client,
      (event) => event.type === 'run:status-changed' && event.phase === 'done',
      30000,
    );
    await daemon.client.approveRun({ runId: run.runId });
    await runDone;

    const finalPlan = await daemon.client.getRunPlan({ runId: run.runId });
    expect(finalPlan?.tasksIndex.tasks[0]).toMatchObject({
      id: 'TASK-001',
      status: 'done',
      retries: 0,
    });
    // Dispatched exactly once: if the dependency hadn't been installed before the check ran,
    // the check would fail and burn a correction retry that re-dispatches the worker.
    expect(runtime?.workerCallCount('TASK-001')).toBe(1);
  });
});
