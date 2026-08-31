import { describe, expect, it, vi } from 'vitest';

const { execFileSync, execFile } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execFileSync, execFile }));

const { detectInstalledProviders, detectInstalledProvidersAsync } = await import(
  './availability.js'
);

function mockExecFile(shouldFail: (binary: string) => Error | undefined): void {
  execFile.mockImplementation(
    (binary: string, _args: string[], _options: unknown, callback: (error?: Error) => void) => {
      callback(shouldFail(binary));
    },
  );
}

function enoent(): NodeJS.ErrnoException {
  const error = new Error('spawn ENOENT') as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

describe('detectInstalledProviders', () => {
  it('includes a provider whose CLI runs successfully', () => {
    execFileSync.mockReturnValue(Buffer.from(''));

    expect(detectInstalledProviders()).toEqual(new Set(['claude', 'codex', 'opencode']));
  });

  it('excludes a provider whose CLI is not on PATH', () => {
    execFileSync.mockImplementation((binary: string) => {
      if (binary === 'opencode') throw enoent();
      return Buffer.from('');
    });

    expect(detectInstalledProviders()).toEqual(new Set(['claude', 'codex']));
  });

  it('still counts a CLI installed when it exits non-zero on --version', () => {
    execFileSync.mockImplementation((binary: string) => {
      if (binary === 'codex') throw new Error('exit code 1');
      return Buffer.from('');
    });

    expect(detectInstalledProviders()).toEqual(new Set(['claude', 'codex', 'opencode']));
  });
});

describe('detectInstalledProvidersAsync', () => {
  it('includes a provider whose CLI runs successfully', async () => {
    mockExecFile(() => undefined);

    await expect(detectInstalledProvidersAsync()).resolves.toEqual(
      new Set(['claude', 'codex', 'opencode']),
    );
  });

  it('excludes a provider whose CLI is not on PATH', async () => {
    mockExecFile((binary) => (binary === 'opencode' ? enoent() : undefined));

    await expect(detectInstalledProvidersAsync()).resolves.toEqual(new Set(['claude', 'codex']));
  });

  it('still counts a CLI installed when it exits non-zero on --version', async () => {
    mockExecFile((binary) => (binary === 'codex' ? new Error('exit code 1') : undefined));

    await expect(detectInstalledProvidersAsync()).resolves.toEqual(
      new Set(['claude', 'codex', 'opencode']),
    );
  });
});
