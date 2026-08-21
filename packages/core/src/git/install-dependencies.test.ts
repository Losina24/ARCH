import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWorktreeDependencies } from './install-dependencies.js';

vi.mock('execa', () => ({ execa: vi.fn().mockResolvedValue({}) }));

const mockedExeca = vi.mocked(execa);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arch-install-deps-'));
  mockedExeca.mockClear();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('installWorktreeDependencies', () => {
  it('runs a frozen-lockfile pnpm install when pnpm-lock.yaml is present', async () => {
    await writeFile(join(dir, 'pnpm-lock.yaml'), '', 'utf-8');

    await installWorktreeDependencies(dir);

    expect(mockedExeca).toHaveBeenCalledWith('pnpm', ['install', '--frozen-lockfile'], {
      cwd: dir,
    });
  });

  it('runs yarn before npm when both yarn.lock and package-lock.json are present', async () => {
    await writeFile(join(dir, 'yarn.lock'), '', 'utf-8');
    await writeFile(join(dir, 'package-lock.json'), '', 'utf-8');

    await installWorktreeDependencies(dir);

    expect(mockedExeca).toHaveBeenCalledWith('yarn', ['install', '--frozen-lockfile'], {
      cwd: dir,
    });
    expect(mockedExeca).toHaveBeenCalledTimes(1);
  });

  it('runs npm ci when only package-lock.json is present', async () => {
    await writeFile(join(dir, 'package-lock.json'), '', 'utf-8');

    await installWorktreeDependencies(dir);

    expect(mockedExeca).toHaveBeenCalledWith('npm', ['ci'], { cwd: dir });
  });

  it('runs a frozen-lockfile bun install when bun.lockb is present', async () => {
    await writeFile(join(dir, 'bun.lockb'), '', 'utf-8');

    await installWorktreeDependencies(dir);

    expect(mockedExeca).toHaveBeenCalledWith('bun', ['install', '--frozen-lockfile'], {
      cwd: dir,
    });
  });

  it('does nothing when no recognized lockfile exists', async () => {
    await mkdir(join(dir, 'src'), { recursive: true });

    await installWorktreeDependencies(dir);

    expect(mockedExeca).not.toHaveBeenCalled();
  });
});
