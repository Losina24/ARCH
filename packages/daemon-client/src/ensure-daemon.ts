import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getArchPaths } from '@arch/config';
import { DAEMON_BIN_PATH, isDaemonAlive, spawnDaemonDetached } from '@arch/daemon';
import { ArchClient } from './arch-client.js';

const SPAWN_RETRY_ATTEMPTS = 100;
const SPAWN_RETRY_DELAY_MS = 150;

export async function ensureDaemon(cwd: string): Promise<ArchClient> {
  const { archDir, socketPath } = getArchPaths(cwd);

  if (!(await isDaemonAlive(socketPath))) {
    spawnDaemonDetached(DAEMON_BIN_PATH, cwd);
    let spawned = false;
    for (let attempt = 0; attempt < SPAWN_RETRY_ATTEMPTS; attempt += 1) {
      if (await isDaemonAlive(socketPath)) {
        spawned = true;
        break;
      }
      await delay(SPAWN_RETRY_DELAY_MS);
    }
    if (!spawned) {
      throw new Error(
        `Daemon did not come up on ${socketPath} within ${
          (SPAWN_RETRY_ATTEMPTS * SPAWN_RETRY_DELAY_MS) / 1000
        }s. Check ${join(archDir, 'daemon.log')} for errors.`,
      );
    }
  }

  return ArchClient.connect(socketPath);
}

export async function withClient<T>(
  cwd: string,
  fn: (client: ArchClient) => Promise<T>,
): Promise<T> {
  const client = await ensureDaemon(cwd);
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}
