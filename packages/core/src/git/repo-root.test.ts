import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverReposIn, resolveRepoRoot, resolveRunCwd } from './repo-root.js';

describe('resolveRepoRoot', () => {
  let repo: string;

  beforeEach(async () => {
    // Resolved with realpath because git itself resolves symlinks in its output (e.g. macOS's
    // /tmp -> /private/tmp), so an un-resolved tmpdir() path would never compare equal.
    repo = await realpath(await mkdtemp(join(tmpdir(), 'arch-repo-root-test-')));
    await execa('git', ['init'], { cwd: repo });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('resolves the repo root when cwd already is the root', async () => {
    expect(await resolveRepoRoot(repo)).toBe(repo);
  });

  it('resolves the repo root when cwd is a subdirectory', async () => {
    const sub = join(repo, 'nested', 'dir');
    await mkdir(sub, { recursive: true });

    expect(await resolveRepoRoot(sub)).toBe(repo);
  });

  it('throws a clear error when cwd is not inside a git repository', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'arch-not-a-repo-'));
    try {
      await expect(resolveRepoRoot(outside)).rejects.toThrow(/is not inside a git repository/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('discoverReposIn', () => {
  let container: string;

  beforeEach(async () => {
    container = await realpath(await mkdtemp(join(tmpdir(), 'arch-multi-repo-')));
  });

  afterEach(async () => {
    await rm(container, { recursive: true, force: true });
  });

  it('lists immediate subdirectories that are git repositories', async () => {
    const repoA = join(container, 'service-a');
    const repoB = join(container, 'service-b');
    const notARepo = join(container, 'docs');
    await mkdir(repoA);
    await mkdir(repoB);
    await mkdir(notARepo);
    await execa('git', ['init'], { cwd: repoA });
    await execa('git', ['init'], { cwd: repoB });

    const repos = await discoverReposIn(container);

    expect(new Set(repos)).toEqual(new Set([repoA, repoB]));
  });

  it('returns an empty array when there are no git repositories inside', async () => {
    await mkdir(join(container, 'docs'));
    expect(await discoverReposIn(container)).toEqual([]);
  });

  it('returns an empty array when the directory does not exist', async () => {
    expect(await discoverReposIn(join(container, 'missing'))).toEqual([]);
  });
});

describe('resolveRunCwd', () => {
  let container: string;

  beforeEach(async () => {
    container = await realpath(await mkdtemp(join(tmpdir(), 'arch-run-cwd-')));
  });

  afterEach(async () => {
    await rm(container, { recursive: true, force: true });
  });

  it('resolves to the repo root when cwd is itself a git repository', async () => {
    await execa('git', ['init'], { cwd: container });
    expect(await resolveRunCwd(container)).toBe(container);
  });

  it('returns cwd as-is when it holds several git repositories but is not one itself', async () => {
    const repoA = join(container, 'service-a');
    await mkdir(repoA);
    await execa('git', ['init'], { cwd: repoA });

    expect(await resolveRunCwd(container)).toBe(container);
  });

  it('throws when cwd is neither a repository nor a container of any', async () => {
    await mkdir(join(container, 'docs'));
    await expect(resolveRunCwd(container)).rejects.toThrow(/is not inside a git repository/);
  });
});
