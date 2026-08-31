import { runClaudeHeadless } from '@losina/claude-runtime';
import { runCodexHeadless } from '@losina/codex-runtime';
import { runOpencodeHeadless } from '@losina/opencode-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeTransientDispatchFailure,
  isTransientDispatchError,
  runAgentHeadless,
} from './run-headless.js';

vi.mock('@losina/claude-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@losina/claude-runtime')>()),
  runClaudeHeadless: vi.fn(),
}));
vi.mock('@losina/codex-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@losina/codex-runtime')>()),
  runCodexHeadless: vi.fn(),
}));
vi.mock('@losina/opencode-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@losina/opencode-runtime')>()),
  runOpencodeHeadless: vi.fn(),
}));

const mockedRunClaudeHeadless = vi.mocked(runClaudeHeadless);
const mockedRunCodexHeadless = vi.mocked(runCodexHeadless);
const mockedRunOpencodeHeadless = vi.mocked(runOpencodeHeadless);

beforeEach(() => {
  mockedRunClaudeHeadless.mockReset();
  mockedRunCodexHeadless.mockReset();
  mockedRunOpencodeHeadless.mockReset();
});

describe('runAgentHeadless', () => {
  it('dispatches a claude model to runClaudeHeadless', async () => {
    mockedRunClaudeHeadless.mockResolvedValue({ sessionId: 's', output: 'o' });
    const result = await runAgentHeadless({ prompt: 'p', model: 'sonnet', cwd: '/tmp' });
    expect(result).toEqual({ sessionId: 's', output: 'o' });
    expect(mockedRunClaudeHeadless).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'sonnet' }),
    );
    expect(mockedRunCodexHeadless).not.toHaveBeenCalled();
  });

  it('dispatches a gpt/codex model to runCodexHeadless', async () => {
    mockedRunCodexHeadless.mockResolvedValue({ sessionId: 's', output: 'o' });
    const result = await runAgentHeadless({ prompt: 'p', model: 'gpt-5.1-codex', cwd: '/tmp' });
    expect(result).toEqual({ sessionId: 's', output: 'o' });
    expect(mockedRunCodexHeadless).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.1-codex' }),
    );
    expect(mockedRunClaudeHeadless).not.toHaveBeenCalled();
  });

  it('dispatches an opencode-style model to runOpencodeHeadless', async () => {
    mockedRunOpencodeHeadless.mockResolvedValue({ sessionId: 's', output: 'o' });
    const result = await runAgentHeadless({
      prompt: 'p',
      model: 'github-copilot/gpt-4.1',
      cwd: '/tmp',
    });
    expect(result).toEqual({ sessionId: 's', output: 'o' });
    expect(mockedRunOpencodeHeadless).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'github-copilot/gpt-4.1' }),
    );
    expect(mockedRunClaudeHeadless).not.toHaveBeenCalled();
    expect(mockedRunCodexHeadless).not.toHaveBeenCalled();
  });
});

describe('isTransientDispatchError', () => {
  it('is true for all providers transient error classes', async () => {
    const { ClaudeApiRejectionError, ClaudeStreamAbortedError } =
      await vi.importActual<typeof import('@losina/claude-runtime')>('@losina/claude-runtime');
    const { CodexApiRejectionError, CodexStreamAbortedError } =
      await vi.importActual<typeof import('@losina/codex-runtime')>('@losina/codex-runtime');
    const { OpencodeApiRejectionError, OpencodeStreamAbortedError } = await vi.importActual<
      typeof import('@losina/opencode-runtime')
    >('@losina/opencode-runtime');

    expect(isTransientDispatchError(new ClaudeApiRejectionError(400, 'x'))).toBe(true);
    expect(isTransientDispatchError(new ClaudeStreamAbortedError('aborted_streaming', 0.4))).toBe(
      true,
    );
    expect(isTransientDispatchError(new CodexApiRejectionError(4, 'x'))).toBe(true);
    expect(isTransientDispatchError(new CodexStreamAbortedError('x'))).toBe(true);
    expect(isTransientDispatchError(new OpencodeApiRejectionError('x'))).toBe(true);
    expect(isTransientDispatchError(new OpencodeStreamAbortedError('x'))).toBe(true);
  });

  it('is false for an unrelated error', () => {
    expect(isTransientDispatchError(new Error('boom'))).toBe(false);
  });
});

describe('describeTransientDispatchFailure', () => {
  it('describes a rejection vs an abort for every provider', async () => {
    const { ClaudeApiRejectionError, ClaudeStreamAbortedError } =
      await vi.importActual<typeof import('@losina/claude-runtime')>('@losina/claude-runtime');
    const { CodexApiRejectionError, CodexStreamAbortedError } =
      await vi.importActual<typeof import('@losina/codex-runtime')>('@losina/codex-runtime');
    const { OpencodeApiRejectionError, OpencodeStreamAbortedError } = await vi.importActual<
      typeof import('@losina/opencode-runtime')
    >('@losina/opencode-runtime');

    expect(describeTransientDispatchFailure(new ClaudeApiRejectionError(400, 'x'))).toBe(
      'dispatch rejected before execution',
    );
    expect(describeTransientDispatchFailure(new CodexApiRejectionError(4, 'x'))).toBe(
      'dispatch rejected before execution',
    );
    expect(describeTransientDispatchFailure(new OpencodeApiRejectionError('x'))).toBe(
      'dispatch rejected before execution',
    );
    expect(
      describeTransientDispatchFailure(new ClaudeStreamAbortedError('aborted_streaming', 0.4)),
    ).toBe('dispatch aborted mid-stream');
    expect(describeTransientDispatchFailure(new CodexStreamAbortedError('x'))).toBe(
      'dispatch aborted mid-stream',
    );
    expect(describeTransientDispatchFailure(new OpencodeStreamAbortedError('x'))).toBe(
      'dispatch aborted mid-stream',
    );
  });
});
