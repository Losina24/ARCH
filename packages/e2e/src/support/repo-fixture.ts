import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

export interface RepoFixture {
  cwd: string;
  cleanup: () => Promise<void>;
}

async function initRepoAt(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execa('git', ['init', '--initial-branch=main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'arch-e2e@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'ARCH E2E'], { cwd: dir });

  await writeFile(join(dir, 'README.md'), '# ARCH e2e fixture repository\n', 'utf-8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '-m', 'chore: initial commit'], { cwd: dir });
}

// archDir/socketPath/configPath now live under ~/.arch (os.homedir() reads $HOME on POSIX) —
// stub it per fixture so e2e runs never touch the real developer machine's ~/.arch.
async function stubHome(): Promise<{ homeDir: string; restore: () => Promise<void> }> {
  const previousHome = process.env.HOME;
  const homeDir = await mkdtemp(join(tmpdir(), 'arch-e2e-home-'));
  process.env.HOME = homeDir;
  return {
    homeDir,
    restore: async () => {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    },
  };
}

export async function createRepoFixture(): Promise<RepoFixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'arch-e2e-repo-'));
  await initRepoAt(cwd);
  const home = await stubHome();

  return {
    cwd,
    cleanup: async () => {
      await home.restore();
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

export interface MultiRepoFixture {
  /** The plain container folder — NOT a git repo itself — holding both repos as subdirectories. */
  cwd: string;
  repoA: string;
  repoB: string;
  cleanup: () => Promise<void>;
}

/**
 * Simulates a run whose `cwd` spans several independent sibling repositories, e.g. a folder
 * containing several projects side by side rather than a single git checkout.
 */
export async function createMultiRepoFixture(): Promise<MultiRepoFixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'arch-e2e-multi-repo-'));
  const repoA = join(cwd, 'service-a');
  const repoB = join(cwd, 'service-b');
  await Promise.all([initRepoAt(repoA), initRepoAt(repoB)]);
  const home = await stubHome();

  return {
    cwd,
    repoA,
    repoB,
    cleanup: async () => {
      await home.restore();
      await rm(cwd, { recursive: true, force: true });
    },
  };
}
