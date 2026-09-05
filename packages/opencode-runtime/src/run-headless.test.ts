import { access, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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

  // OpenCode's CLI has no stdin-prompt mode (unlike Claude/Codex) — the prompt is always a
  // positional argv element, so a prompt anywhere close to Windows' ~32K-character command-line
  // limit risks the same ENAMETOOLONG crash fixed elsewhere in this codebase. Below a
  // conservative threshold, behavior must stay exactly as today (inline, positional, no temp
  // file) — this is the regression guard for that.
  //
  // NOTE: the cases below encode the *proposed* over-threshold mechanism (attach via `-f`
  // instead of inline). This has not been validated against a real `opencode` install — there
  // is none available in this environment — so it verifies the argv-construction contract this
  // code claims to have, not that OpenCode actually honors `-f` as a prompt source the way this
  // assumes. Re-validate live before relying on it.
  describe('oversized prompt handling', () => {
    it('stays inline for a prompt under the threshold', async () => {
      mockStdout(jsonl({ type: 'step_start', sessionID: 'ses-1' }));
      const prompt = 'a short prompt';

      await runOpencodeHeadless({ prompt, model: 'github-copilot/gpt-4.1', cwd: '/tmp/project' });

      const [, args] = mockedExeca.mock.calls[0] ?? [];
      expect(args).toContain(prompt);
      expect(args).not.toContain('-f');
    });

    it('attaches an over-threshold prompt as a file instead of inlining it', async () => {
      const hugePrompt = 'x'.repeat(20_000);
      // The temp file only exists for the duration of the call — its content must be captured
      // from inside the mocked execa invocation, before this function's own cleanup deletes it,
      // not read back afterward.
      let fileContentDuringCall: string | undefined;
      let capturedPath: string | undefined;
      mockedExeca.mockImplementation(async (...callArgs: unknown[]) => {
        const args = callArgs[1] as string[];
        const fileFlagIndex = args.indexOf('-f');
        capturedPath = args[fileFlagIndex + 1];
        fileContentDuringCall = await readFile(capturedPath as string, 'utf-8');
        return { stdout: jsonl({ type: 'step_start', sessionID: 'ses-1' }) } as never;
      });

      await runOpencodeHeadless({
        prompt: hugePrompt,
        model: 'github-copilot/gpt-4.1',
        cwd: '/tmp/project',
      });

      const [, args] = mockedExeca.mock.calls[0] ?? [];
      expect(args).not.toContain(hugePrompt);
      expect(args).toContain('-f');
      expect(fileContentDuringCall).toBe(hugePrompt);
      // Every arg besides the attached file's own path must stay well under the OS limit.
      for (const arg of args ?? []) {
        expect(arg.length).toBeLessThan(1000);
      }

      // Cleaned up after a successful call — never left behind to accumulate.
      await expect(access(dirname(capturedPath as string))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('cleans up the temp file even when the call fails', async () => {
      mockedExeca.mockRejectedValue(new Error('spawn opencode ENOENT'));
      const hugePrompt = 'x'.repeat(20_000);

      await expect(
        runOpencodeHeadless({
          prompt: hugePrompt,
          model: 'github-copilot/gpt-4.1',
          cwd: '/tmp/project',
        }),
      ).rejects.toThrow();

      const [, args] = mockedExeca.mock.calls[0] ?? [];
      const fileFlagIndex = args?.indexOf('-f') ?? -1;
      const capturedPath = args?.[fileFlagIndex + 1];
      await expect(access(dirname(capturedPath as string))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
  });

  it('reports every JSONL event through onEvent', async () => {
    const events = [
      { type: 'step_start', sessionID: 'ses-1' },
      {
        type: 'tool_use',
        sessionID: 'ses-1',
        part: {
          type: 'tool',
          tool: 'bash',
          state: { status: 'completed', input: { command: 'pnpm test' } },
        },
      },
      { type: 'text', sessionID: 'ses-1', part: { type: 'text', text: 'done' } },
    ];
    mockStdout(jsonl(...events));
    const onEvent = vi.fn();

    await runOpencodeHeadless({
      prompt: 'p',
      model: 'github-copilot/gpt-4.1',
      cwd: '/tmp',
      onEvent,
    });

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual(events);
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

  // Regression test: a spawn-time OS failure (ENAMETOOLONG, and plausibly ENOENT/E2BIG) happens
  // before any process starts, so execa's error for it may carry no `.stdout` at all — unlike
  // every other failure case, which all originate from a process that did start. Without
  // matching on `command` too, such an error used to fall through every classifier and execa's
  // raw, unsanitized `.message` (the full command line included) got thrown as-is. With no
  // session ever started, this lands on the existing "no session ever started"
  // OpencodeApiRejectionError path rather than OpencodeCliExecutionError — a different class,
  // but built the same short, sanitized way, so the property that actually matters (never leaks
  // the command) still holds.
  it('sanitizes a spawn-time failure with no stdout instead of leaking the raw command', async () => {
    const spawnError = Object.assign(
      new Error('Command failed with ENAMETOOLONG: opencode run ...'),
      { code: 'ENAMETOOLONG', command: 'opencode run ...', exitCode: undefined },
    );
    mockedExeca.mockRejectedValue(spawnError);

    const promise = runOpencodeHeadless({
      prompt: 'p',
      model: 'github-copilot/gpt-4.1',
      cwd: '/tmp',
    });
    await expect(promise).rejects.toBeInstanceOf(OpencodeApiRejectionError);
    await promise.catch((error: Error) => {
      expect(error.message).not.toContain('opencode run');
      expect(error.message.length).toBeLessThan(200);
    });
  });

  it('throws OpencodeCliExecutionError when the CLI exits 0 without ever producing a session id', async () => {
    mockStdout('');
    await expect(
      runOpencodeHeadless({ prompt: 'p', model: 'github-copilot/gpt-4.1', cwd: '/tmp' }),
    ).rejects.toBeInstanceOf(OpencodeCliExecutionError);
  });
});
