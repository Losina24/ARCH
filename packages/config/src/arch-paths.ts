import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const ARCH_HOME_DIRNAME = '.arch';
const CONFIG_FILENAME = 'config.json';

export interface ArchPaths {
  archDir: string;
  socketPath: string;
  runsDir: string;
  configPath: string;
}

// Repos are told apart by a hash of their absolute path (never by name alone, since two
// different repos can share a basename) — the name prefix is only there so a human skimming
// ~/.arch/projects/ can tell which directory belongs to which repo.
function projectSlug(cwd: string): string {
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 8);
  const name = basename(cwd).replace(/[^a-zA-Z0-9-]/g, '-') || 'project';
  return `${name}-${hash}`;
}

export function getArchPaths(cwd: string): ArchPaths {
  const archDir = join(homedir(), ARCH_HOME_DIRNAME, 'projects', projectSlug(cwd));
  return {
    archDir,
    socketPath: join(archDir, 'daemon.sock'),
    runsDir: join(archDir, 'runs'),
    configPath: join(archDir, CONFIG_FILENAME),
  };
}
