import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentMeshConfig } from '@losina/schemas';
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
    // POSIX, %USERPROFILE% on Windows) — stub both so these tests never touch the real
    // developer machine's ~/.arch.
    homeDir = await mkdtemp(join(tmpdir(), 'arch-config-test-home-'));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
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
        workerModel: 'claude-haiku-4-5-20251001',
      },
      execution: { maxConcurrency: 8, maxRetries: 1, useWorktrees: true },
    };
    await saveConfig(cwd, custom);
    expect(await loadConfig(cwd)).toEqual(custom);
  });

  it('loads a config file written before the TL role was removed, dropping the leftover tlModel field', async () => {
    const { configPath } = getArchPaths(cwd);
    await mkdir(join(configPath, '..'), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        models: {
          architectModel: 'claude-opus-5',
          tlModel: 'claude-sonnet-5',
          workerModel: 'claude-sonnet-5',
        },
        execution: { maxConcurrency: 4, maxRetries: 3, useWorktrees: true },
      }),
      'utf-8',
    );

    const loaded = await loadConfig(cwd);
    expect(loaded.models).not.toHaveProperty('tlModel');
    expect(loaded.models).toEqual({
      architectModel: 'claude-opus-5',
      workerModel: 'claude-sonnet-5',
    });
  });

  it('creates the project directory under ~/.arch if it does not exist yet', async () => {
    const { configPath } = getArchPaths(cwd);
    await saveConfig(cwd, DEFAULT_CONFIG);
    await expect(loadConfig(cwd)).resolves.toEqual(DEFAULT_CONFIG);
    expect(configPath.startsWith(join(homeDir, '.arch', 'projects'))).toBe(true);
  });

  it('rejects saving a config that fails schema validation', async () => {
    const invalid = {
      models: { architectModel: 'a', workerModel: 'c' },
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
