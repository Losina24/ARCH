import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodexApiRejectionError,
  CodexCliExecutionError,
  CodexStreamAbortedError,
  runCodexHeadless,
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

describe('runCodexHeadless', () => {
  it('builds the base CLI args and parses the JSONL result', async () => {
    mockStdout(
      jsonl(
        { type: 'thread.started', thread_id: 'thread-1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'done' } },
        { type: 'turn.completed' },
      ),
    );

    const result = await runCodexHeadless({
      prompt: 'Add a function',
      model: 'codex',
      cwd: '/tmp/project',
    });

    expect(result).toEqual({ sessionId: 'thread-1', output: 'done' });
    const [command, args, opts] = mockedExeca.mock.calls[0] ?? [];
    expect(command).toBe('codex');
    expect(args).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--json',
      '--model',
      'gpt-5.1-codex',
      '--cd',
      '/tmp/project',
      'Add a function',
    ]);
    expect(opts).toMatchObject({ cwd: '/tmp/project' });
  });

  it('resolves a short model alias before passing it to the CLI', async () => {
    mockStdout(jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.completed' }));
    await runCodexHeadless({ prompt: 'p', model: 'gpt5', cwd: '/tmp' });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).toContain('gpt-5.1');
  });

  it('appends --yolo for bypassPermissions', async () => {
    mockStdout(jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.completed' }));
    await runCodexHeadless({
      prompt: 'p',
      model: 'codex',
      cwd: '/tmp',
      permissionMode: 'bypassPermissions',
    });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).toContain('--yolo');
  });

  it('appends --full-auto for acceptEdits', async () => {
    mockStdout(jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.completed' }));
    await runCodexHeadless({
      prompt: 'p',
      model: 'codex',
      cwd: '/tmp',
      permissionMode: 'acceptEdits',
    });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).toContain('--full-auto');
  });

  it('builds a resume invocation with the thread id before the prompt', async () => {
    mockStdout(jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.completed' }));
    await runCodexHeadless({
      prompt: 'continue',
      model: 'codex',
      cwd: '/tmp',
      resumeSessionId: 'thread-0',
    });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args.slice(-3)).toEqual(['resume', 'thread-0', 'continue']);
  });

  it('forwards the AbortSignal as cancelSignal', async () => {
    mockStdout(jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.completed' }));
    const controller = new AbortController();
    await runCodexHeadless({ prompt: 'p', model: 'codex', cwd: '/tmp', signal: controller.signal });
    const [, , opts] = mockedExeca.mock.calls[0] ?? [];
    expect((opts as Record<string, unknown>).cancelSignal).toBe(controller.signal);
  });

  it('throws when additionalDirs is used outside bypassPermissions', async () => {
    await expect(
      runCodexHeadless({
        prompt: 'p',
        model: 'codex',
        cwd: '/tmp',
        permissionMode: 'acceptEdits',
        additionalDirs: ['/other/dir'],
      }),
    ).rejects.toThrow(/additionalDirs requires permissionMode/);
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it('throws CodexApiRejectionError when the CLI fails before any turn started', async () => {
    const execaError = Object.assign(new Error('Command failed with exit code 4: codex exec ...'), {
      stdout: '',
      exitCode: 4,
    });
    mockedExeca.mockRejectedValue(execaError);

    const promise = runCodexHeadless({ prompt: 'p', model: 'codex', cwd: '/tmp' });
    await expect(promise).rejects.toBeInstanceOf(CodexApiRejectionError);
    await expect(promise).rejects.toMatchObject({ exitCode: 4 });
  });

  it('throws CodexStreamAbortedError when a turn started but never completed', async () => {
    const execaError = Object.assign(new Error('Command failed with exit code 1: codex exec ...'), {
      stdout: jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.started' }),
      exitCode: 1,
    });
    mockedExeca.mockRejectedValue(execaError);

    await expect(
      runCodexHeadless({ prompt: 'p', model: 'codex', cwd: '/tmp' }),
    ).rejects.toBeInstanceOf(CodexStreamAbortedError);
  });

  it('wraps an unparseable CLI failure in a short CodexCliExecutionError', async () => {
    const execaError = Object.assign(new Error('Command failed with exit code 1: codex exec ...'), {
      stdout: jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.completed' }),
      exitCode: 1,
    });
    mockedExeca.mockRejectedValue(execaError);

    const promise = runCodexHeadless({ prompt: 'p', model: 'codex', cwd: '/tmp' });
    await expect(promise).rejects.toBeInstanceOf(CodexCliExecutionError);
    await promise.catch((error: Error) => {
      expect(error.message).not.toContain('codex exec');
      expect(error.message).toContain('exit code 1');
    });
  });

  it('throws CodexCliExecutionError when the CLI exits 0 without ever emitting thread.started', async () => {
    mockStdout('');
    await expect(
      runCodexHeadless({ prompt: 'p', model: 'codex', cwd: '/tmp' }),
    ).rejects.toBeInstanceOf(CodexCliExecutionError);
  });
});
