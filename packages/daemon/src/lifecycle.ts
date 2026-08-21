import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { getArchPaths } from '@arch/config';

export async function isDaemonAlive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

export function spawnDaemonDetached(daemonEntrypoint: string, cwd: string): void {
  const { archDir } = getArchPaths(cwd);
  mkdirSync(archDir, { recursive: true });
  const logFd = openSync(join(archDir, 'daemon.log'), 'a');

  const child = spawn(process.execPath, [daemonEntrypoint], {
    cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  // Node dup's these fds into the child's own table at spawn time, so the
  // parent's copy can be closed immediately without affecting the daemon.
  closeSync(logFd);
}
