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

function jsonl(...events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

function mockStdout(json: unknown) {
  mockedExeca.mockResolvedValue({ stdout: JSON.stringify(json) } as never);
}

beforeEach(() => {
  mockedExeca.mockReset();
});

describe('runClaudeHeadless', () => {
  it('builds the base CLI args and parses the JSON result', async () => {
    mockStdout({ type: 'result', session_id: 'session-1', result: 'done' });

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
      '--model',
      'claude-sonnet-5',
      '--output-format',
      'stream-json',
      '--verbose',
      '--setting-sources',
      'project,local',
    ]);
    expect(opts).toMatchObject({ cwd: '/tmp/project', input: 'Add a function' });
  });

  // Regression test for a real production incident: a task's full review prompt (brief + diff +
  // corrections) can easily run past Windows' ~32K-character command-line limit. Passing it as
  // an argv element makes `execa` fail with ENAMETOOLONG before `claude` even starts — the CLI
  // never gets a chance to reject or accept the call. The prompt must travel via stdin, which
  // has no such limit, exactly like codex-runtime already does.
  it('never puts the prompt in argv, regardless of size', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });
    const hugePrompt = 'x'.repeat(200_000);

    await runClaudeHeadless({ prompt: hugePrompt, model: 'sonnet', cwd: '/tmp' });

    const [, args, opts] = mockedExeca.mock.calls[0] ?? [];
    expect(args).not.toContain(hugePrompt);
    for (const arg of args ?? []) {
      expect(typeof arg === 'string' ? arg.length : 0).toBeLessThan(1000);
    }
    expect(opts).toMatchObject({ input: hugePrompt });
  });

  it('delivers the prompt via stdin alongside --resume, independently of each other', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });

    await runClaudeHeadless({
      prompt: 'Continue the previous work',
      model: 'sonnet',
      cwd: '/tmp',
      resumeSessionId: 'session-0',
    });

    const [, args, opts] = mockedExeca.mock.calls[0] ?? [];
    expect(args).toEqual(expect.arrayContaining(['--resume', 'session-0']));
    expect(args).not.toContain('Continue the previous work');
    expect(opts).toMatchObject({ input: 'Continue the previous work' });
  });

  // stdin has no escaping semantics at all — unlike argv, where execa/the shell must correctly
  // quote quotes, backticks, `&&`, and embedded newlines for the child to see them literally.
  // Moving the prompt off argv closes that whole class of "happened to work depending on how
  // it got quoted" risk, not just the size limit.
  it('delivers a prompt with argv-hostile characters unmodified via stdin', async () => {
    mockStdout({ session_id: 'session-1', result: 'done' });
    const trickyPrompt = 'Say "hi" && `echo pwned`\nline two\nline three';

    await runClaudeHeadless({ prompt: trickyPrompt, model: 'sonnet', cwd: '/tmp' });

    const [, , opts] = mockedExeca.mock.calls[0] ?? [];
    expect(opts).toMatchObject({ input: trickyPrompt });
  });

  it('reports every JSONL event through onEvent', async () => {
    const events = [
      { type: 'system', subtype: 'init', session_id: 'session-1' },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }] },
      },
      { type: 'result', session_id: 'session-1', result: 'done' },
    ];
    mockedExeca.mockResolvedValue({ stdout: jsonl(...events) } as never);
    const onEvent = vi.fn();

    await runClaudeHeadless({
      prompt: 'p',
      model: 'sonnet',
      cwd: '/tmp',
      onEvent,
    });

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual(events);
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

  // Regression test for the actual incident this suite exists to prevent: a spawn-time OS
  // failure (ENAMETOOLONG, and plausibly ENOENT/E2BIG) happens before any process starts, so
  // execa's error for it may carry no `.stdout` at all — unlike every other error case above,
  // which all originate from a process that did start and produced output. Without this, such an
  // error falls through every classifier and execa's raw, unsanitized `.message` (which used to
  // embed the entire `-p <prompt>` argument) is thrown as-is.
  it('wraps a spawn-time failure with no stdout in a short ClaudeCliExecutionError', async () => {
    const spawnError = Object.assign(
      new Error('Command failed with ENAMETOOLONG: claude -p "..." --model claude-sonnet-5 ...'),
      {
        code: 'ENAMETOOLONG',
        command: 'claude -p "..." --model claude-sonnet-5 ...',
        exitCode: undefined,
      },
    );
    mockedExeca.mockRejectedValue(spawnError);

    const promise = runClaudeHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' });
    await expect(promise).rejects.toBeInstanceOf(ClaudeCliExecutionError);
    await promise.catch((error: Error) => {
      expect(error.message.split('\n').length).toBeLessThanOrEqual(2);
      expect(error.message).not.toContain('claude -p');
    });
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
