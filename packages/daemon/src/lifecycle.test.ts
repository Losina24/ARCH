import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getArchPaths } from '@losina/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDaemonAlive, spawnDaemonDetached } from './lifecycle.js';

describe('isDaemonAlive', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arch-lifecycle-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is false when nothing is listening on the socket path', async () => {
    expect(await isDaemonAlive(join(dir, 'daemon.sock'))).toBe(false);
  });

  it('is true when a server is listening on the socket path', async () => {
    const socketPath = join(dir, 'daemon.sock');
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      expect(await isDaemonAlive(socketPath)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('spawnDaemonDetached', () => {
  let cwd: string;
  let entrypoint: string;
  let homeDir: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'arch-lifecycle-spawn-test-'));
    entrypoint = join(cwd, 'fake-daemon.js');
    await writeFile(entrypoint, "console.log('hello from daemon');\n", 'utf-8');
    // archDir now lives under ~/.arch (os.homedir() reads $HOME on POSIX) — stub it so this
    // test never writes to the real developer machine's ~/.arch.
    homeDir = await mkdtemp(join(tmpdir(), 'arch-lifecycle-spawn-test-home-'));
    process.env.HOME = homeDir;
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  it("creates daemon.log under archDir and captures the child's stdout", async () => {
    spawnDaemonDetached(entrypoint, cwd);

    const { archDir } = getArchPaths(cwd);
    let logContent = '';
    for (let attempt = 0; attempt < 50; attempt += 1) {
      logContent = await readFile(join(archDir, 'daemon.log'), 'utf-8').catch(() => '');
      if (logContent.includes('hello from daemon')) break;
      await delay(50);
    }

    expect(logContent).toContain('hello from daemon');
  });
});
