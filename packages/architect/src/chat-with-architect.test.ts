import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentHeadless } from '@losina/agent-runtime';
import type { RunMeta } from '@losina/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatWithArchitect } from './chat-with-architect.js';
import { fileExists } from './util/file-exists.js';

vi.mock('@losina/agent-runtime', () => ({ runAgentHeadless: vi.fn() }));

const mockedRunAgentHeadless = vi.mocked(runAgentHeadless);

describe('chatWithArchitect', () => {
  let cwd: string;
  let runDir: string;
  let runRequestFilePath: string;
  let run: RunMeta;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'arch-chat-test-'));
    runDir = await mkdtemp(join(tmpdir(), 'arch-chat-rundir-'));
    runRequestFilePath = join(runDir, 'chat-run-request.json');
    run = {
      runId: 'run-1',
      title: 'Add add(a, b)',
      prompt: 'Add a function that sums two numbers',
      cwd,
      phase: 'done',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    };
    mockedRunAgentHeadless.mockReset();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(runDir, { recursive: true, force: true });
  });

  const baseInput = () => ({
    run,
    runDir,
    plan: null,
    message: 'How is it going?',
    model: 'sonnet',
  });

  it('returns just the reply when the agent writes no run-request file', async () => {
    mockedRunAgentHeadless.mockResolvedValue({ sessionId: 'session-1', output: 'All good.' });

    const result = await chatWithArchitect(baseInput());

    expect(result).toEqual({ sessionId: 'session-1', reply: 'All good.' });
  });

  it('returns the parsed run-request prompt when the agent writes the file, and deletes it after', async () => {
    mockedRunAgentHeadless.mockImplementation(async () => {
      await writeFile(
        runRequestFilePath,
        JSON.stringify({ prompt: 'Add a subtract(a, b) function too.' }),
        'utf-8',
      );
      return { sessionId: 'session-1', output: "Sure, I've started a new run for that." };
    });

    const result = await chatWithArchitect(baseInput());

    expect(result).toEqual({
      sessionId: 'session-1',
      reply: "Sure, I've started a new run for that.",
      runRequest: 'Add a subtract(a, b) function too.',
    });
    await expect(fileExists(runRequestFilePath)).resolves.toBe(false);
  });

  it('forwards model/cwd/resumeSessionId/signal and grants access to the run-request file location', async () => {
    mockedRunAgentHeadless.mockResolvedValue({ sessionId: 'session-2', output: 'Understood.' });
    const controller = new AbortController();
    const onProgress = vi.fn();

    await chatWithArchitect({
      ...baseInput(),
      resumeSessionId: 'previous-session',
      signal: controller.signal,
      onProgress,
    });

    const call = mockedRunAgentHeadless.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model: 'sonnet',
      cwd,
      resumeSessionId: 'previous-session',
      signal: controller.signal,
      onProgress,
      permissionMode: 'bypassPermissions',
    });
    expect(call?.additionalDirs).toEqual([runDir]);
  });
});
