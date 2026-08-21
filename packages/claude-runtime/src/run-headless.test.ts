import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeApiRejectionError,
  ClaudeCliExecutionError,
  ClaudeStreamAbortedError,
  runClaudeHeadless,
} from './run-headless.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const mockedExeca = vi.mocked(execa);

function mockStdout(json: unknown) {
  mockedExeca.mockResolvedValue({ stdout: JSON.stringify(json) } as never);
}

beforeEach(() => {
  mockedExeca.mockReset();
});

describe('runClaudeHeadless', () => {
  it('builds the base CLI args and parses the JSON result', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });

    const result = await runClaudeHeadless({
      prompt: 'Add a function',
      model: 'sonnet',
      cwd: '/tmp/project',
    });

    expect(result).toEqual({ sessionId: 'session-1', output: 'done' });
    const [command, args, opts] = mockedExeca.mock.calls[0] ?? [];
    expect(command).toBe('claude');
    expect(args).toEqual([
      '-p',
      'Add a function',
      '--model',
      'claude-sonnet-5',
      '--output-format',
      'json',
      '--setting-sources',
      'project,local',
    ]);
    expect(opts).toMatchObject({ cwd: '/tmp/project' });
  });

  it('excludes the user setting source so headless dispatch ignores the operator advisor setting', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });
    await runClaudeHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).toEqual(expect.arrayContaining(['--setting-sources', 'project,local']));
  });

  it('resolves a short model alias before passing it to the CLI', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });
    await runClaudeHeadless({ prompt: 'p', model: 'opus', cwd: '/tmp' });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).toContain('claude-opus-5');
  });

  it('appends --resume when a resumeSessionId is provided', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });
    await runClaudeHeadless({
      prompt: 'p',
      model: 'sonnet',
      cwd: '/tmp',
      resumeSessionId: 'session-0',
    });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).toEqual(expect.arrayContaining(['--resume', 'session-0']));
  });

  it('appends --permission-mode when provided', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });
    await runClaudeHeadless({
      prompt: 'p',
      model: 'sonnet',
      cwd: '/tmp',
      permissionMode: 'acceptEdits',
    });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits']));
  });

  it('omits --resume and --permission-mode when not provided', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });
    await runClaudeHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--permission-mode');
  });

  it('appends one --add-dir per entry in additionalDirs', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });
    await runClaudeHeadless({
      prompt: 'p',
      model: 'sonnet',
      cwd: '/tmp',
      additionalDirs: ['/home/user/.arch/projects/repo-abc/runs/run-1', '/other/dir'],
    });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).toEqual(
      expect.arrayContaining([
        '--add-dir',
        '/home/user/.arch/projects/repo-abc/runs/run-1',
        '--add-dir',
        '/other/dir',
      ]),
    );
  });

  it('omits --add-dir when additionalDirs is not provided', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });
    await runClaudeHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' });
    const [, args] = mockedExeca.mock.calls[0] ?? [];
    expect(args).not.toContain('--add-dir');
  });

  // Regression test: execa@9 renamed its abort option from `signal` to `cancelSignal`.
  // Passing `signal` is silently the wrong key pre-v9 semantics and throws at runtime on v9,
  // which previously broke every worker dispatch and architect review that used an AbortSignal.
  it('forwards the AbortSignal as cancelSignal, not as signal', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });
    const controller = new AbortController();

    await runClaudeHeadless({
      prompt: 'p',
      model: 'sonnet',
      cwd: '/tmp',
      signal: controller.signal,
    });

    const [, , opts] = mockedExeca.mock.calls[0] ?? [];
    expect((opts as Record<string, unknown>).cancelSignal).toBe(controller.signal);
    expect(opts).not.toHaveProperty('signal');
  });

  it('propagates a rejection from execa', async () => {
    mockedExeca.mockRejectedValue(new Error('spawn claude ENOENT'));
    await expect(runClaudeHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' })).rejects.toThrow(
      'spawn claude ENOENT',
    );
  });

  // Regression test: the CLI exits non-zero on a pre-execution rejection (an incompatible
  // advisorModel setting causing an HTTP 400 before any turn runs) but still writes its JSON
  // result body to stdout. execa throws on that non-zero exit but attaches the captured stdout
  // to the error it throws — this must be recognized and re-thrown as a typed, retry-safe error
  // instead of the generic "Command failed with exit code 1" execa produces.
  it('throws ClaudeApiRejectionError when execa fails on a pre-execution api_error with $0 billed', async () => {
    const execaError = Object.assign(new Error('Command failed with exit code 1: claude -p ...'), {
      stdout: JSON.stringify({
        terminal_reason: 'api_error',
        total_cost_usd: 0,
        api_error_status: 400,
        result: 'API Error: {"type":"error"} · advisorModel is incompatible with the request model',
      }),
    });
    mockedExeca.mockRejectedValue(execaError);

    const promise = runClaudeHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' });
    await expect(promise).rejects.toBeInstanceOf(ClaudeApiRejectionError);
    await expect(promise).rejects.toMatchObject({ apiErrorStatus: 400 });
  });

  // Regression test: the CLI's turn loop can be cut off mid-response after billing real work
  // (e.g. the model connection dropped mid-stream) — distinct from a $0 pre-execution rejection
  // only in that some cost was already incurred. Still safe to retry, since none of that partial
  // work was ever reported back to the caller.
  it('throws ClaudeStreamAbortedError when the CLI aborts mid-stream after billing a turn', async () => {
    const execaError = Object.assign(new Error('Command failed with exit code 1: claude -p ...'), {
      stdout: JSON.stringify({
        terminal_reason: 'aborted_streaming',
        total_cost_usd: 0.4163,
        num_turns: 15,
      }),
    });
    mockedExeca.mockRejectedValue(execaError);

    const promise = runClaudeHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' });
    await expect(promise).rejects.toBeInstanceOf(ClaudeStreamAbortedError);
    await expect(promise).rejects.toMatchObject({ totalCostUsd: 0.4163 });
    // The message must stay short — it must never embed the full escaped CLI command (which
    // includes the entire multi-thousand-character prompt argument), unlike execa's own
    // .message/.shortMessage.
    await promise.catch((error: Error) => {
      expect(error.message.split('\n').length).toBeLessThanOrEqual(2);
      expect(error.message).not.toContain('claude -p');
    });
  });

  // Any other non-zero exit from the CLI must still surface a short, fixed-shape message —
  // never execa's own .message/.shortMessage, which embed the full escaped command line
  // (including the entire `-p <prompt>` argument, thousands of characters for a worker dispatch).
  it('wraps an unparseable CLI failure in a short ClaudeCliExecutionError', async () => {
    const execaError = Object.assign(new Error('Command failed with exit code 1: claude -p ...'), {
      stdout: 'not json',
      exitCode: 1,
    });
    mockedExeca.mockRejectedValue(execaError);

    const promise = runClaudeHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' });
    await expect(promise).rejects.toBeInstanceOf(ClaudeCliExecutionError);
    await promise.catch((error: Error) => {
      expect(error.message.split('\n').length).toBeLessThanOrEqual(2);
      expect(error.message).not.toContain('claude -p');
      expect(error.message).toContain('exit code 1');
    });
  });

  it('wraps a failure that billed a turn but is not a stream abort in ClaudeCliExecutionError', async () => {
    const execaError = Object.assign(new Error('Command failed with exit code 1: claude -p ...'), {
      stdout: JSON.stringify({ terminal_reason: 'api_error', total_cost_usd: 0.02 }),
      exitCode: 1,
    });
    mockedExeca.mockRejectedValue(execaError);

    await expect(
      runClaudeHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' }),
    ).rejects.toBeInstanceOf(ClaudeCliExecutionError);
  });

  it('wraps a failure with an unrelated terminal_reason in ClaudeCliExecutionError', async () => {
    const execaError = Object.assign(new Error('Command failed with exit code 1: claude -p ...'), {
      stdout: JSON.stringify({ terminal_reason: 'error_max_turns', total_cost_usd: 0 }),
      exitCode: 1,
    });
    mockedExeca.mockRejectedValue(execaError);

    await expect(
      runClaudeHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' }),
    ).rejects.toBeInstanceOf(ClaudeCliExecutionError);
  });
});
