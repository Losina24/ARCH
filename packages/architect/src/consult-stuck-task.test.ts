import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentHeadless } from '@losina/agent-runtime';
import type { RunMeta } from '@losina/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consultStuckTask } from './consult-stuck-task.js';
import { fileExists } from './util/file-exists.js';

vi.mock('@losina/agent-runtime', () => ({ runAgentHeadless: vi.fn() }));

const mockedRunAgentHeadless = vi.mocked(runAgentHeadless);

describe('consultStuckTask', () => {
  let cwd: string;
  let consultationFilePath: string;
  let run: RunMeta;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'arch-consult-test-'));
    consultationFilePath = join(cwd, 'TASK-001.consultation.1.json');
    run = {
      runId: 'run-1',
      title: 'Write marker file',
      prompt: 'Write a marker file',
      cwd,
      phase: 'implementation',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    };
    mockedRunAgentHeadless.mockReset();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const baseInput = () => ({
    run,
    taskId: 'TASK-001',
    taskMarkdown: '# Write a marker file',
    correctionMarkdowns: [],
    gitDiff: '',
    workerSummary: 'done',
    failureReason: 'Automated checks kept failing.',
    failureKind: 'checks' as const,
    retriesSpent: 0,
    maxRetries: 0,
    model: 'sonnet',
    consultationFilePath,
  });

  it('returns the parsed question and recommendation when the agent writes the consultation file', async () => {
    mockedRunAgentHeadless.mockImplementation(async () => {
      await writeFile(
        consultationFilePath,
        JSON.stringify({ question: 'Root or dist?', recommendation: 'Root.' }),
        'utf-8',
      );
      return { sessionId: 'session-1', output: 'CONSULTATION_READY' };
    });

    const result = await consultStuckTask(baseInput());

    expect(result).toEqual({
      sessionId: 'session-1',
      question: 'Root or dist?',
      recommendation: 'Root.',
    });
  });

  it('deletes the consultation file after reading it', async () => {
    mockedRunAgentHeadless.mockImplementation(async () => {
      await writeFile(
        consultationFilePath,
        JSON.stringify({ question: 'Root or dist?', recommendation: 'Root.' }),
        'utf-8',
      );
      return { sessionId: 'session-1', output: 'CONSULTATION_READY' };
    });

    await consultStuckTask(baseInput());

    await expect(fileExists(consultationFilePath)).resolves.toBe(false);
  });

  it('returns no question when the agent writes nothing — not an error, just "nothing to ask"', async () => {
    mockedRunAgentHeadless.mockResolvedValue({
      sessionId: 'session-1',
      output: 'CONSULTATION_READY',
    });

    const result = await consultStuckTask(baseInput());

    expect(result).toEqual({ sessionId: 'session-1' });
  });

  it('builds the prompt from the failure context and forwards model/cwd/resumeSessionId/signal', async () => {
    mockedRunAgentHeadless.mockResolvedValue({
      sessionId: 'session-2',
      output: 'CONSULTATION_READY',
    });
    const controller = new AbortController();
    const onProgress = vi.fn();

    await consultStuckTask({
      ...baseInput(),
      resumeSessionId: 'previous-session',
      signal: controller.signal,
      onProgress,
    });

    const call = mockedRunAgentHeadless.mock.calls[0]?.[0];
    expect(call?.prompt).toContain('Stuck task: TASK-001');
    expect(call?.prompt).toContain('Automated checks kept failing.');
    expect(call).toMatchObject({
      model: 'sonnet',
      cwd,
      resumeSessionId: 'previous-session',
      signal: controller.signal,
      onProgress,
      permissionMode: 'bypassPermissions',
    });
  });
});
