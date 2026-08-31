import { describe, expect, it, vi } from 'vitest';

// `promisify(execFile)` relies on Node attaching a `promisify.custom` implementation to the real
// `execFile` that resolves to `{ stdout, stderr }` instead of just the callback's first value. The
// mock below replicates that (via the well-known cross-realm symbol, since `vi.hoisted` runs
// before this file's own imports are initialized) so `opencode-models.ts`'s `promisify(execFile)`
// behaves the same way against this fake as it does against the real Node API.
const { execFile } = vi.hoisted(() => {
  const promisifyCustomSymbol = Symbol.for('nodejs.util.promisify.custom');
  const fn = vi.fn() as unknown as ((...args: unknown[]) => void) & {
    [key: symbol]: (file: string, args: string[], options: unknown) => Promise<unknown>;
  };
  fn[promisifyCustomSymbol] = (file: string, args: string[], options: unknown) =>
    new Promise((resolve, reject) => {
      fn(file, args, options, (error: Error | null, stdout: string, stderr: string) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    });
  return { execFile: fn };
});
vi.mock('node:child_process', () => ({ execFile }));

const { listOpenCodeModels } = await import('./opencode-models.js');

function mockExecFile(handler: (callback: (error: Error | null, stdout: string) => void) => void) {
  execFile.mockImplementation(
    (
      _binary: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => handler(callback),
  );
}

describe('listOpenCodeModels', () => {
  it('parses one model id per line, trimming and dropping blank lines', async () => {
    mockExecFile((callback) =>
      callback(null, 'github-copilot/gpt-4.1\n  anthropic/claude-opus-5  \n\nopenai/gpt-5.1\n'),
    );

    await expect(listOpenCodeModels()).resolves.toEqual([
      'github-copilot/gpt-4.1',
      'anthropic/claude-opus-5',
      'openai/gpt-5.1',
    ]);
  });

  it('returns an empty list when the CLI is missing', async () => {
    mockExecFile((callback) => {
      const error = new Error('spawn ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      callback(error, '');
    });

    await expect(listOpenCodeModels()).resolves.toEqual([]);
  });

  it('returns an empty list when the command fails for any other reason', async () => {
    mockExecFile((callback) => callback(new Error('not authenticated'), ''));

    await expect(listOpenCodeModels()).resolves.toEqual([]);
  });
});
