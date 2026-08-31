import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OpencodeApiRejectionError,
  OpencodeCliExecutionError,
  OpencodeStreamAbortedError,
  runOpencodeHeadless,
} from './run-headless.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const mockedExeca = vi.mocked(execa);

function jsonl(...events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

function mockStdout(stdout: string) {
  mockedExeca.mockResolvedValue({ stdout } as never);
}

beforeEach(() => {
  mockedExeca.mockReset();
});

describe('runOpencodeHeadless', () => {
  it('builds the base CLI args and parses the JSONL result', async () => {
    mockStdout(
      jsonl(
        { type: 'step_start', sessionID: 'ses-1' },
        { type: 'text', sessionID: 'ses-1', part: { type: 'text', text: 'done' } },
        { type: 'step_finish', sessionID: 'ses-1', part: { reason: 'stop' } },
      ),
    );

    const result = await runOpencodeHeadless({
      prompt: 'Add a function',
      model: 'github-copilot/gpt-4.1',
      cwd: '/tmp/project',
    });

    expect(result).toEqual({ sessionId: 'ses-1', output: 'done' });
    const [command, args, opts] = mockedExeca.mock.calls[0] ?? [];
    expect(command).toBe('opencode');
    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '-m',
      'github-copilot/gpt-4.1',
      '--dir',
      '/tmp/project',
      'Add a function',
    ]);
    expect(opts).toMatchObject({ cwd: '/tmp/project' });
  });

  it('appends --agent plan for plan permission mode', async () => {
    mockStdout(jsonl({ type: 'text', sessionID: 'ses-1', part: { type: 'text', text: 'done' } }));
    await runOpencodeHeadless({
      prompt: 'p',
      model: 'github-copilot/gpt-4.1',
      cwd: '/tmp',
      permissionMode: 'plan',
    });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).toContain('--agent');
    expect(args).toContain('plan');
  });

  it('does not append an --agent flag for bypassPermissions', async () => {
    mockStdout(jsonl({ type: 'text', sessionID: 'ses-1', part: { type: 'text', text: 'done' } }));
    await runOpencodeHeadless({
      prompt: 'p',
      model: 'github-copilot/gpt-4.1',
      cwd: '/tmp',
      permissionMode: 'bypassPermissions',
    });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).not.toContain('--agent');
  });

  it('builds a resume invocation with -s before the prompt', async () => {
    mockStdout(jsonl({ type: 'text', sessionID: 'ses-1', part: { type: 'text', text: 'done' } }));
    await runOpencodeHeadless({
      prompt: 'continue',
      model: 'github-copilot/gpt-4.1',
      cwd: '/tmp',
      resumeSessionId: 'ses-0',
    });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args.slice(-3)).toEqual(['-s', 'ses-0', 'continue']);
  });

  it('forwards the AbortSignal as cancelSignal', async () => {
    mockStdout(jsonl({ type: 'text', sessionID: 'ses-1', part: { type: 'text', text: 'done' } }));
    const controller = new AbortController();
    await runOpencodeHeadless({
      prompt: 'p',
      model: 'github-copilot/gpt-4.1',
      cwd: '/tmp',
      signal: controller.signal,
    });
    const [, , opts] = mockedExeca.mock.calls[0] ?? [];
    expect((opts as Record<string, unknown>).cancelSignal).toBe(controller.signal);
  });

  it('throws when additionalDirs is used outside bypassPermissions', async () => {
    await expect(
      runOpencodeHeadless({
        prompt: 'p',
        model: 'github-copilot/gpt-4.1',
        cwd: '/tmp',
        permissionMode: 'acceptEdits',
        additionalDirs: ['/other/dir'],
      }),
    ).rejects.toThrow(/additionalDirs requires permissionMode/);
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it('throws OpencodeApiRejectionError when the CLI reports an error event with no prior text (exit 0)', async () => {
    mockStdout(
      jsonl({
        type: 'error',
        sessionID: 'ses-1',
        error: { name: 'UnknownError', data: { message: 'Model not found.' } },
      }),
    );

    const promise = runOpencodeHeadless({
      prompt: 'p',
      model: 'github-copilot/nonexistent',
      cwd: '/tmp',
    });
    await expect(promise).rejects.toBeInstanceOf(OpencodeApiRejectionError);
    await promise.catch((error: Error) => {
      expect(error.message).toContain('Model not found.');
    });
  });

  it('throws OpencodeStreamAbortedError when an error event follows some assistant text (exit 0)', async () => {
    mockStdout(
      jsonl(
        { type: 'text', sessionID: 'ses-1', part: { type: 'text', text: 'partial' } },
        { type: 'error', sessionID: 'ses-1', error: { name: 'UnknownError' } },
      ),
    );

    await expect(
      runOpencodeHeadless({ prompt: 'p', model: 'github-copilot/gpt-4.1', cwd: '/tmp' }),
    ).rejects.toBeInstanceOf(OpencodeStreamAbortedError);
  });

  it('throws OpencodeApiRejectionError when the CLI crashes before any session id appeared', async () => {
    const execaError = Object.assign(
      new Error('Command failed with exit code 1: opencode run ...'),
      {
        stdout: '',
        exitCode: 1,
      },
    );
    mockedExeca.mockRejectedValue(execaError);

    await expect(
      runOpencodeHeadless({ prompt: 'p', model: 'github-copilot/gpt-4.1', cwd: '/tmp' }),
    ).rejects.toBeInstanceOf(OpencodeApiRejectionError);
  });

  it('wraps an unparseable CLI crash in a short OpencodeCliExecutionError', async () => {
    const execaError = Object.assign(
      new Error('Command failed with exit code 1: opencode run ...'),
      {
        stdout: jsonl(
          { type: 'text', sessionID: 'ses-1', part: { type: 'text', text: 'done' } },
          { type: 'step_finish', sessionID: 'ses-1', part: { reason: 'stop' } },
        ),
        exitCode: 1,
      },
    );
    mockedExeca.mockRejectedValue(execaError);

    const promise = runOpencodeHeadless({
      prompt: 'p',
      model: 'github-copilot/gpt-4.1',
      cwd: '/tmp',
    });
    await expect(promise).rejects.toBeInstanceOf(OpencodeCliExecutionError);
    await promise.catch((error: Error) => {
      expect(error.message).not.toContain('opencode run');
      expect(error.message).toContain('exit code 1');
    });
  });

  it('throws OpencodeCliExecutionError when the CLI exits 0 without ever producing a session id', async () => {
    mockStdout('');
    await expect(
      runOpencodeHeadless({ prompt: 'p', model: 'github-copilot/gpt-4.1', cwd: '/tmp' }),
    ).rejects.toBeInstanceOf(OpencodeCliExecutionError);
  });
});
