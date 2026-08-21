import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

export interface RepoFixture {
  cwd: string;
  cleanup: () => Promise<void>;
}

export async function createRepoFixture(): Promise<RepoFixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'arch-e2e-repo-'));

  await execa('git', ['init', '--initial-branch=main'], { cwd });
  await execa('git', ['config', 'user.email', 'arch-e2e@example.com'], { cwd });
  await execa('git', ['config', 'user.name', 'ARCH E2E'], { cwd });

  await writeFile(join(cwd, 'README.md'), '# ARCH e2e fixture repository\n', 'utf-8');
  await execa('git', ['add', '-A'], { cwd });
  await execa('git', ['commit', '-m', 'chore: initial commit'], { cwd });

  // archDir/socketPath/configPath now live under ~/.arch (os.homedir() reads $HOME on POSIX) —
  // stub it per fixture so e2e runs never touch the real developer machine's ~/.arch.
  const previousHome = process.env.HOME;
  const homeDir = await mkdtemp(join(tmpdir(), 'arch-e2e-home-'));
  process.env.HOME = homeDir;

  return {
    cwd,
    cleanup: async () => {
      process.env.HOME = previousHome;
      await Promise.all([
        rm(cwd, { recursive: true, force: true }),
        rm(homeDir, { recursive: true, force: true }),
      ]);
    },
  };
}
