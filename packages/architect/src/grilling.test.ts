import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentHeadless } from '@losina/agent-runtime';
import { getArchPaths } from '@losina/config';
import type { RunMeta } from '@losina/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGrillingRound } from './grilling.js';

vi.mock('@losina/agent-runtime', () => ({ runAgentHeadless: vi.fn() }));

const mockedRunAgentHeadless = vi.mocked(runAgentHeadless);

describe('runGrillingRound', () => {
  let cwd: string;
  let homeDir: string;
  let run: RunMeta;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'arch-grilling-test-'));
    homeDir = await mkdtemp(join(tmpdir(), 'arch-grilling-test-home-'));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    run = {
      runId: 'run-1',
      title: 'Add add(a, b)',
      prompt: 'Add a function that sums two numbers',
      cwd,
      phase: 'grilling',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    };
    mockedRunAgentHeadless.mockReset();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  async function questionFilePath() {
    const { archDir } = getArchPaths(cwd);
    const runDir = join(archDir, 'runs', run.runId);
    await mkdir(runDir, { recursive: true });
    return join(runDir, 'question.json');
  }

  it('returns done: false with the parsed question when the agent writes question.json', async () => {
    mockedRunAgentHeadless.mockImplementation(async () => {
      const path = await questionFilePath();
      await writeFile(
        path,
        JSON.stringify({ question: 'Which database?', recommendation: 'PostgreSQL' }),
        'utf-8',
      );
      return { sessionId: 'session-1', output: 'QUESTION_READY' };
    });

    const result = await runGrillingRound({ run, model: 'sonnet' });

    expect(result).toEqual({
      sessionId: 'session-1',
      done: false,
      question: 'Which database?',
      recommendation: 'PostgreSQL',
    });
  });

  it('deletes question.json after reading it, so a later round starts clean', async () => {
    let path = '';
    mockedRunAgentHeadless.mockImplementation(async () => {
      path = await questionFilePath();
      await writeFile(
        path,
        JSON.stringify({ question: 'Which database?', recommendation: 'PostgreSQL' }),
        'utf-8',
      );
      return { sessionId: 'session-1', output: 'QUESTION_READY' };
    });

    await runGrillingRound({ run, model: 'sonnet' });

    await expect(readFileExists(path)).resolves.toBe(false);
  });

  it('returns done: true when the agent does not write question.json', async () => {
    mockedRunAgentHeadless.mockResolvedValue({ sessionId: 'session-1', output: 'GRILLING_DONE' });

    const result = await runGrillingRound({ run, model: 'sonnet' });

    expect(result).toEqual({ sessionId: 'session-1', done: true });
  });

  it('uses buildGrillingPrompt (no priorAnswer) on the first round', async () => {
    mockedRunAgentHeadless.mockResolvedValue({ sessionId: 'session-1', output: 'GRILLING_DONE' });

    await runGrillingRound({ run, model: 'sonnet' });

    const call = mockedRunAgentHeadless.mock.calls[0]?.[0];
    expect(call?.prompt).toContain(run.prompt);
    expect(call?.prompt).not.toContain('The user answered your previous question');
  });

  it('uses buildGrillingAnswerPrompt (with priorAnswer) on later rounds', async () => {
    mockedRunAgentHeadless.mockResolvedValue({ sessionId: 'session-2', output: 'GRILLING_DONE' });

    await runGrillingRound({ run, model: 'sonnet', priorAnswer: 'Use PostgreSQL' });

    const call = mockedRunAgentHeadless.mock.calls[0]?.[0];
    expect(call?.prompt).toContain('Use PostgreSQL');
  });

  it('forwards model, cwd, resumeSessionId and signal to runAgentHeadless', async () => {
    mockedRunAgentHeadless.mockResolvedValue({ sessionId: 'session-3', output: 'GRILLING_DONE' });
    const controller = new AbortController();
    const onProgress = vi.fn();

    await runGrillingRound({
      run,
      model: 'opus',
      resumeSessionId: 'previous-session',
      signal: controller.signal,
      onProgress,
    });

    const call = mockedRunAgentHeadless.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model: 'opus',
      cwd,
      resumeSessionId: 'previous-session',
      signal: controller.signal,
      onProgress,
      permissionMode: 'bypassPermissions',
    });
  });
});

async function readFileExists(path: string): Promise<boolean> {
  const { fileExists } = await import('./util/file-exists.js');
  return fileExists(path);
}
