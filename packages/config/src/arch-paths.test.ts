import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getArchPaths } from './arch-paths.js';

// getArchPaths derives every path from os.homedir(), which reads $HOME on POSIX — stub it to a
// throwaway directory so these tests never touch the real developer machine's ~/.arch.
let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'arch-paths-test-home-'));
  process.env.HOME = homeDir;
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe('getArchPaths', () => {
  it('derives every path under ~/.arch/projects/<slug>, never inside cwd', () => {
    const paths = getArchPaths('/tmp/my-project');
    expect(paths.archDir.startsWith(join(homeDir, '.arch', 'projects'))).toBe(true);
    expect(paths.archDir.startsWith('/tmp/my-project')).toBe(false);
    expect(paths.socketPath).toBe(join(paths.archDir, 'daemon.sock'));
    expect(paths.runsDir).toBe(join(paths.archDir, 'runs'));
    expect(paths.configPath).toBe(join(paths.archDir, 'config.json'));
  });

  it('is stable across repeated calls for the same cwd', () => {
    expect(getArchPaths('/tmp/a')).toEqual(getArchPaths('/tmp/a'));
  });

  it('derives a different archDir for different cwds', () => {
    expect(getArchPaths('/tmp/a').archDir).not.toBe(getArchPaths('/tmp/b').archDir);
  });

  it('includes a sanitized basename of cwd in the slug for readability', () => {
    const paths = getArchPaths('/tmp/My Repo!');
    expect(paths.archDir).toContain('My-Repo-');
  });
});
