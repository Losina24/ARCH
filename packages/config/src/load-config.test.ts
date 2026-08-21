import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentMeshConfig } from '@arch/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getArchPaths } from './arch-paths.js';
import { DEFAULT_CONFIG } from './default-config.js';
import { loadConfig, saveConfig } from './load-config.js';

describe('loadConfig / saveConfig', () => {
  let cwd: string;
  let homeDir: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'arch-config-test-'));
    // The config now lives under ~/.arch/projects/<slug>/, derived from os.homedir() ($HOME on
    // POSIX) — stub it so these tests never touch the real developer machine's ~/.arch.
    homeDir = await mkdtemp(join(tmpdir(), 'arch-config-test-home-'));
    process.env.HOME = homeDir;
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  it('returns DEFAULT_CONFIG when no config file exists', async () => {
    expect(await loadConfig(cwd)).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips a saved config', async () => {
    const custom: AgentMeshConfig = {
      models: {
        architectModel: 'claude-opus-5',
        tlModel: 'claude-fable-5',
        workerModel: 'claude-haiku-4-5-20251001',
      },
      execution: { maxConcurrency: 8, maxRetries: 1, useWorktrees: true },
    };
    await saveConfig(cwd, custom);
    expect(await loadConfig(cwd)).toEqual(custom);
  });

  it('creates the project directory under ~/.arch if it does not exist yet', async () => {
    const { configPath } = getArchPaths(cwd);
    await saveConfig(cwd, DEFAULT_CONFIG);
    await expect(loadConfig(cwd)).resolves.toEqual(DEFAULT_CONFIG);
    expect(configPath.startsWith(join(homeDir, '.arch', 'projects'))).toBe(true);
  });

  it('rejects saving a config that fails schema validation', async () => {
    const invalid = {
      models: { architectModel: 'a', tlModel: 'b', workerModel: 'c' },
      execution: { maxConcurrency: 0, maxRetries: 1, useWorktrees: true },
    } as AgentMeshConfig;
    await expect(saveConfig(cwd, invalid)).rejects.toThrow();
  });

  it('propagates a corrupt config file instead of silently falling back to defaults', async () => {
    const { configPath } = getArchPaths(cwd);
    await mkdir(join(configPath, '..'), { recursive: true });
    await writeFile(configPath, '{ not valid json', 'utf-8');
    await expect(loadConfig(cwd)).rejects.toThrow();
  });
});
