import { describe, expect, it } from 'vitest';
import {
  progressFromClaudeEvent,
  progressFromCodexEvent,
  progressFromOpencodeEvent,
} from './progress.js';

const cwd = '/tmp/project';

describe('provider progress normalization', () => {
  it('classifies Codex commands without exposing the command or its secrets', () => {
    const progress = progressFromCodexEvent(
      {
        type: 'item.started',
        item: {
          type: 'command_execution',
          command: 'pnpm --filter app test --token TOP_SECRET',
        },
      },
      cwd,
    );

    expect(progress).toEqual({ state: 'using-tool', tool: 'Shell', detail: 'Running tests' });
    expect(JSON.stringify(progress)).not.toContain('TOP_SECRET');
  });

  it('keeps Codex file activity repo-relative and ignores reasoning text', () => {
    expect(
      progressFromCodexEvent(
        {
          type: 'item.started',
          item: {
            type: 'file_change',
            text: 'PRIVATE_REASONING',
            changes: [{ path: '/tmp/project/src/auth.ts', kind: 'update' }],
          },
        },
        cwd,
      ),
    ).toEqual({
      state: 'using-tool',
      tool: 'Edit',
      detail: 'Editing files',
      file: 'src/auth.ts',
    });
  });

  it('normalizes Claude tool use without forwarding raw tool input', () => {
    const progress = progressFromClaudeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'npm run lint -- --api-key PRIVATE_KEY' },
            },
          ],
        },
      },
      cwd,
    );

    expect(progress).toEqual({ state: 'using-tool', tool: 'Bash', detail: 'Linting code' });
    expect(JSON.stringify(progress)).not.toContain('PRIVATE_KEY');
  });

  it('shows only the basename for a Claude file outside the working directory', () => {
    expect(
      progressFromClaudeEvent(
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Read',
                input: { file_path: '/private/customer-alpha/credentials.ts' },
              },
            ],
          },
        },
        cwd,
      ),
    ).toEqual({
      state: 'using-tool',
      tool: 'Read',
      detail: 'Reading file',
      file: 'credentials.ts',
    });
  });

  it('surfaces Claude connection retries with bounded metadata', () => {
    expect(
      progressFromClaudeEvent(
        { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 5 },
        cwd,
      ),
    ).toEqual({
      state: 'using-tool',
      tool: 'API',
      detail: 'Retrying connection (2/5)',
    });
  });

  it('describes OpenCode tool events as completed because its CLI emits them afterward', () => {
    const progress = progressFromOpencodeEvent(
      {
        type: 'tool_use',
        sessionID: 'ses-1',
        part: {
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'pnpm test --token TOP_SECRET' },
          },
        },
      },
      cwd,
    );

    expect(progress).toEqual({ state: 'thinking', detail: 'Tests completed', file: undefined });
    expect(JSON.stringify(progress)).not.toContain('TOP_SECRET');
  });

  it('reports an OpenCode tool error without exposing the error body', () => {
    const progress = progressFromOpencodeEvent(
      {
        type: 'tool_use',
        sessionID: 'ses-1',
        part: {
          tool: 'read',
          state: {
            status: 'error',
            input: { file_path: '/tmp/project/src/auth.ts' },
            error: 'PRIVATE_ERROR_BODY',
          },
        },
      },
      cwd,
    );

    expect(progress).toEqual({
      state: 'thinking',
      detail: 'Reviewing tool error',
      file: 'src/auth.ts',
    });
    expect(JSON.stringify(progress)).not.toContain('PRIVATE_ERROR_BODY');
  });
});
