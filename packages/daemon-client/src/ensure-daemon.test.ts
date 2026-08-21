import { getArchPaths } from '@arch/config';
import { isDaemonAlive, spawnDaemonDetached } from '@arch/daemon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchClient } from './arch-client.js';
import { ensureDaemon } from './ensure-daemon.js';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(() => Promise.resolve()) }));
vi.mock('@arch/config', () => ({ getArchPaths: vi.fn() }));
vi.mock('@arch/daemon', () => ({
  DAEMON_BIN_PATH: '/fake/bin.js',
  isDaemonAlive: vi.fn(),
  spawnDaemonDetached: vi.fn(),
}));
vi.mock('./arch-client.js', () => ({ ArchClient: { connect: vi.fn() } }));

const mockedGetArchPaths = vi.mocked(getArchPaths);
const mockedIsDaemonAlive = vi.mocked(isDaemonAlive);
const mockedSpawnDaemonDetached = vi.mocked(spawnDaemonDetached);
const mockedConnect = vi.mocked(ArchClient.connect);

const cwd = '/tmp/fake-arch';
const socketPath = '/tmp/fake-arch/.arch/daemon.sock';

describe('ensureDaemon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetArchPaths.mockReturnValue({
      archDir: '/tmp/fake-arch/.arch',
      socketPath,
      runsDir: '/tmp/fake-arch/.arch/runs',
      configPath: '/tmp/fake-arch/.arch/config.json',
    });
    mockedConnect.mockResolvedValue({ close: vi.fn() } as unknown as ArchClient);
  });

  it('connects directly without spawning when the daemon is already alive', async () => {
    mockedIsDaemonAlive.mockResolvedValue(true);

    await ensureDaemon(cwd);

    expect(mockedSpawnDaemonDetached).not.toHaveBeenCalled();
    expect(mockedConnect).toHaveBeenCalledWith(socketPath);
  });

  it('spawns the daemon and retries until it comes alive, then connects', async () => {
    let calls = 0;
    mockedIsDaemonAlive.mockImplementation(async () => {
      calls += 1;
      return calls > 3;
    });

    await ensureDaemon(cwd);

    expect(mockedSpawnDaemonDetached).toHaveBeenCalledTimes(1);
    expect(mockedSpawnDaemonDetached).toHaveBeenCalledWith('/fake/bin.js', cwd);
    expect(calls).toBeGreaterThan(3);
    expect(mockedConnect).toHaveBeenCalledWith(socketPath);
  });

  it('throws a descriptive error mentioning daemon.log when the daemon never comes alive', async () => {
    mockedIsDaemonAlive.mockResolvedValue(false);

    await expect(ensureDaemon(cwd)).rejects.toThrow(/daemon\.log/);
    expect(mockedConnect).not.toHaveBeenCalled();
  });
});
