import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaudeHeadless } from '@losina/claude-runtime';
import { getArchPaths } from '@losina/config';
import type { RunMeta } from '@losina/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planProject } from './plan-project.js';

vi.mock('@losina/claude-runtime', () => ({ runClaudeHeadless: vi.fn() }));

const mockedRunClaudeHeadless = vi.mocked(runClaudeHeadless);

describe('planProject', () => {
  let cwd: string;
  let homeDir: string;
  let run: RunMeta;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'arch-plan-project-test-'));
    // archDir now lives under ~/.arch (os.homedir() reads $HOME on POSIX) — stub it so this
    // test never writes to the real developer machine's ~/.arch.
    homeDir = await mkdtemp(join(tmpdir(), 'arch-plan-project-test-home-'));
    process.env.HOME = homeDir;
    run = {
      runId: 'run-1',
      title: 'Add add(a, b)',
      prompt: 'Add a function that sums two numbers',
      cwd,
      phase: 'definition',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    };
    mockedRunClaudeHeadless.mockReset();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  async function writeFakePlan() {
    const { archDir } = getArchPaths(cwd);
    const runDir = join(archDir, 'runs', run.runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'project.md'), '# Brief\n\nAdd add(a, b).', 'utf-8');
    await writeFile(
      join(runDir, 'tasks-index.yaml'),
      'tasks:\n  - id: TASK-001\n    title: Add add(a, b)\n    status: pending\n    dependsOn: []\n    file: tasks/TASK-001.md\n    correctionFiles: []\n    retries: 0\n    checks: []\n',
      'utf-8',
    );
  }

  it('reads back the plan files the agent is expected to have written', async () => {
    mockedRunClaudeHeadless.mockImplementation(async () => {
      await writeFakePlan();
      return { sessionId: 'session-1', output: 'PLAN_READY' };
    });

    const result = await planProject({ run, model: 'sonnet' });

    expect(result.sessionId).toBe('session-1');
    expect(result.projectMarkdown).toContain('Add add(a, b)');
    expect(result.tasksIndex.tasks).toHaveLength(1);
    expect(result.tasksIndex.tasks[0]?.id).toBe('TASK-001');
  });

  it('uses buildPlanPrompt (no feedback) when no feedback is given', async () => {
    mockedRunClaudeHeadless.mockImplementation(async () => {
      await writeFakePlan();
      return { sessionId: 'session-1', output: 'PLAN_READY' };
    });

    await planProject({ run, model: 'sonnet' });

    const call = mockedRunClaudeHeadless.mock.calls[0]?.[0];
    expect(call?.prompt).not.toContain('User feedback');
    expect(call?.prompt).toContain(run.prompt);
  });

  it('uses buildRefinePlanPrompt (with feedback) when feedback is given', async () => {
    mockedRunClaudeHeadless.mockImplementation(async () => {
      await writeFakePlan();
      return { sessionId: 'session-2', output: 'PLAN_READY' };
    });

    await planProject({ run, model: 'sonnet', feedback: 'Split the task in two' });

    const call = mockedRunClaudeHeadless.mock.calls[0]?.[0];
    expect(call?.prompt).toContain('Split the task in two');
  });

  it('forwards model, cwd, resumeSessionId and signal to runClaudeHeadless', async () => {
    mockedRunClaudeHeadless.mockImplementation(async () => {
      await writeFakePlan();
      return { sessionId: 'session-3', output: 'PLAN_READY' };
    });
    const controller = new AbortController();

    await planProject({
      run,
      model: 'opus',
      resumeSessionId: 'previous-session',
      signal: controller.signal,
    });

    const call = mockedRunClaudeHeadless.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model: 'opus',
      cwd,
      resumeSessionId: 'previous-session',
      signal: controller.signal,
      permissionMode: 'bypassPermissions',
    });
  });

  it('propagates an error when the agent never produced tasks-index.yaml', async () => {
    mockedRunClaudeHeadless.mockResolvedValue({ sessionId: 'session-1', output: 'PLAN_READY' });
    await expect(planProject({ run, model: 'sonnet' })).rejects.toThrow();
  });
});
