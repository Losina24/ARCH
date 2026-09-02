import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorktree, deleteBranch, mergeWorktree, removeWorktree } from './worktree-manager.js';

describe('git worktree lifecycle', () => {
  let repo: string;
  let worktreesDir: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'arch-worktree-test-'));
    await execa('git', ['init'], { cwd: repo });
    await execa('git', ['config', 'user.email', 'arch-test@example.com'], { cwd: repo });
    await execa('git', ['config', 'user.name', 'ARCH Test'], { cwd: repo });
    await writeFile(join(repo, 'README.md'), '# initial\n', 'utf-8');
    await execa('git', ['add', '-A'], { cwd: repo });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: repo });

    worktreesDir = join(repo, '.worktrees');
    await mkdir(worktreesDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('creates a worktree on its own feature branch', async () => {
    const handle = await createWorktree(repo, worktreesDir, 'TASK-001');

    expect(handle.branch).toBe('feat/TASK-001');
    expect(handle.path).toBe(join(worktreesDir, 'TASK-001'));
    const readme = await readFile(join(handle.path, 'README.md'), 'utf-8');
    expect(readme).toBe('# initial\n');
  });

  it('merges the worktree branch back into the repo it was created from', async () => {
    const handle = await createWorktree(repo, worktreesDir, 'TASK-001');
    await writeFile(join(handle.path, 'feature.js'), 'module.exports = 1;\n', 'utf-8');
    await execa('git', ['add', '-A'], { cwd: handle.path });
    await execa('git', ['commit', '-m', 'implement TASK-001'], { cwd: handle.path });

    await mergeWorktree(repo, handle);

    const { stdout: log } = await execa('git', ['log', '--oneline'], { cwd: repo });
    expect(log).toContain('implement TASK-001');
    await expect(readFile(join(repo, 'feature.js'), 'utf-8')).resolves.toContain('module.exports');
  });

  it('removes the worktree directory and its registration', async () => {
    const handle = await createWorktree(repo, worktreesDir, 'TASK-001');

    await removeWorktree(repo, handle);

    const { stdout: list } = await execa('git', ['worktree', 'list'], { cwd: repo });
    expect(list).not.toContain('TASK-001');
    await expect(readFile(join(handle.path, 'README.md'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('deletes the feature branch after the worktree is removed', async () => {
    const handle = await createWorktree(repo, worktreesDir, 'TASK-001');
    await removeWorktree(repo, handle);

    await deleteBranch(repo, handle);

    const { stdout: branches } = await execa('git', ['branch', '--list', handle.branch], {
      cwd: repo,
    });
    expect(branches.trim()).toBe('');
  });

  it('allows a task id to be reused for a new worktree after cleanup', async () => {
    const first = await createWorktree(repo, worktreesDir, 'TASK-001');
    await removeWorktree(repo, first);
    await deleteBranch(repo, first);

    const second = await createWorktree(repo, worktreesDir, 'TASK-001');

    expect(second.branch).toBe('feat/TASK-001');
  });

  it('reuses a failed task worktree and preserves its uncommitted changes', async () => {
    const first = await createWorktree(repo, worktreesDir, 'TASK-001');
    await writeFile(join(first.path, 'partial.txt'), 'keep this work\n', 'utf-8');

    const retried = await createWorktree(repo, worktreesDir, 'TASK-001');

    expect(retried).toEqual(first);
    await expect(readFile(join(retried.path, 'partial.txt'), 'utf-8')).resolves.toBe(
      'keep this work\n',
    );
  });

  it('reattaches an existing feature branch when only the old worktree was removed', async () => {
    const first = await createWorktree(repo, worktreesDir, 'TASK-001');
    await writeFile(join(first.path, 'committed.txt'), 'preserved on branch\n', 'utf-8');
    await execa('git', ['add', '-A'], { cwd: first.path });
    await execa('git', ['commit', '-m', 'partial task work'], { cwd: first.path });
    await removeWorktree(repo, first);

    const retried = await createWorktree(repo, worktreesDir, 'TASK-001');

    expect(retried).toEqual(first);
    await expect(readFile(join(retried.path, 'committed.txt'), 'utf-8')).resolves.toBe(
      'preserved on branch\n',
    );
  });

  it('keeps two task worktrees on independent branches from the same base', async () => {
    const a = await createWorktree(repo, worktreesDir, 'TASK-001');
    const b = await createWorktree(repo, worktreesDir, 'TASK-002');

    expect(a.branch).not.toBe(b.branch);
    expect(a.path).not.toBe(b.path);
  });
});
