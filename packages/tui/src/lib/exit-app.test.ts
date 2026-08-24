import type { ArchClient } from '@losina/daemon-client';
import type { RunMeta } from '@losina/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exitApp } from './exit-app.js';

function runMeta(overrides: Partial<RunMeta>): RunMeta {
  return {
    runId: 'run-1',
    title: 'Add login page',
    prompt: 'Add a login page',
    cwd: '/tmp/project',
    phase: 'definition',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockClient(overrides: Partial<ArchClient> = {}): ArchClient {
  return {
    listRuns: vi.fn().mockResolvedValue([]),
    shutdownDaemon: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as unknown as ArchClient;
}

describe('exitApp', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('shuts down the daemon and exits when no run is active', async () => {
    const client = mockClient({ listRuns: vi.fn().mockResolvedValue([runMeta({})]) });

    await exitApp(client);

    expect(client.shutdownDaemon).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('leaves the daemon running when a run is mid-implementation', async () => {
    const client = mockClient({
      listRuns: vi.fn().mockResolvedValue([runMeta({ phase: 'implementation' })]),
    });

    await exitApp(client);

    expect(client.shutdownDaemon).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('force-shuts-down the daemon regardless of active runs when force is set', async () => {
    const client = mockClient({
      listRuns: vi.fn().mockResolvedValue([runMeta({ phase: 'implementation' })]),
    });

    await exitApp(client, { force: true });

    expect(client.shutdownDaemon).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('still exits the process when the daemon is unreachable', async () => {
    const client = mockClient({ listRuns: vi.fn().mockRejectedValue(new Error('gone')) });

    await exitApp(client);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits without touching the daemon when no client is connected yet', async () => {
    await exitApp(null);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
