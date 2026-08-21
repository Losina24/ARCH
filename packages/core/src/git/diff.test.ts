import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitAll,
  getChangedFiles,
  getCurrentBranch,
  getStagedDiff,
  getStagedFiles,
  hasStagedChanges,
  revertFiles,
  stageAll,
} from './diff.js';

describe('git diff/stage/commit helpers', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'arch-diff-test-'));
    await execa('git', ['init'], { cwd: repo });
    await execa('git', ['config', 'user.email', 'arch-test@example.com'], { cwd: repo });
    await execa('git', ['config', 'user.name', 'ARCH Test'], { cwd: repo });
    await writeFile(join(repo, 'README.md'), '# initial\n', 'utf-8');
    await execa('git', ['add', '-A'], { cwd: repo });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: repo });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('reports no staged changes on a clean worktree', async () => {
    expect(await hasStagedChanges(repo)).toBe(false);
    expect(await getStagedFiles(repo)).toEqual([]);
  });

  it('stages a new file so it shows up in the staged diff and file list', async () => {
    await writeFile(join(repo, 'src.js'), 'module.exports = 1;\n', 'utf-8');

    await stageAll(repo);

    expect(await hasStagedChanges(repo)).toBe(true);
    expect(await getStagedFiles(repo)).toEqual(['src.js']);
    expect(await getStagedDiff(repo)).toContain('src.js');
  });

  it('commits the staged changes and clears the staged diff', async () => {
    await writeFile(join(repo, 'src.js'), 'module.exports = 1;\n', 'utf-8');
    await stageAll(repo);

    await commitAll(repo, 'Add src.js');

    expect(await hasStagedChanges(repo)).toBe(false);
    const { stdout: log } = await execa('git', ['log', '--oneline'], { cwd: repo });
    expect(log).toContain('Add src.js');
  });

  it('allows an empty commit, used when a task run makes no file changes', async () => {
    await commitAll(repo, 'No-op task');
    const { stdout: log } = await execa('git', ['log', '--oneline'], { cwd: repo });
    expect(log).toContain('No-op task');
  });

  it('reports the current branch', async () => {
    await execa('git', ['checkout', '-b', 'feat/TASK-001'], { cwd: repo });
    expect(await getCurrentBranch(repo)).toBe('feat/TASK-001');
  });

  describe('revertFiles', () => {
    it('restores a tracked file to its last-committed content', async () => {
      await writeFile(join(repo, 'README.md'), '# modified\n', 'utf-8');

      await revertFiles(repo, ['README.md']);

      await expect(readFile(join(repo, 'README.md'), 'utf-8')).resolves.toBe('# initial\n');
      expect(await getChangedFiles(repo)).toEqual([]);
    });

    it('deletes an untracked file', async () => {
      await writeFile(join(repo, 'stray.txt'), 'oops\n', 'utf-8');

      await revertFiles(repo, ['stray.txt']);

      await expect(access(join(repo, 'stray.txt'))).rejects.toThrow();
      expect(await getChangedFiles(repo)).toEqual([]);
    });

    it('reverts only the given paths, leaving other dirty files untouched', async () => {
      await writeFile(join(repo, 'README.md'), '# modified\n', 'utf-8');
      await writeFile(join(repo, 'keep.txt'), 'keep me\n', 'utf-8');

      await revertFiles(repo, ['README.md']);

      await expect(readFile(join(repo, 'README.md'), 'utf-8')).resolves.toBe('# initial\n');
      await expect(readFile(join(repo, 'keep.txt'), 'utf-8')).resolves.toBe('keep me\n');
    });
  });
});
