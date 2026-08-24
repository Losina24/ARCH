import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DaemonServerHandle, startDaemonServer } from '@losina/daemon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchClient } from './arch-client.js';

describe('ArchClient', () => {
  let dir: string;
  let socketPath: string;
  let handleRequest: ReturnType<typeof vi.fn>;
  let handle: DaemonServerHandle;
  let client: ArchClient;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arch-arch-client-test-'));
    socketPath = join(dir, 'daemon.sock');
    handleRequest = vi.fn(async (method: string, payload: unknown) => ({ method, payload }));
    handle = await startDaemonServer(socketPath, handleRequest);
    client = await ArchClient.connect(socketPath);
  });

  afterEach(async () => {
    client.close();
    await handle.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('forwards createRun to run.create with the payload', async () => {
    const result = await client.createRun({ prompt: 'p', cwd: '/tmp' });
    expect(handleRequest).toHaveBeenCalledWith('run.create', { prompt: 'p', cwd: '/tmp' });
    expect(result).toEqual({ method: 'run.create', payload: { prompt: 'p', cwd: '/tmp' } });
  });

  it('forwards listRuns to run.list, defaulting to an empty payload', async () => {
    await client.listRuns();
    expect(handleRequest).toHaveBeenCalledWith('run.list', {});
  });

  it('forwards getRun/approveRun/abortRun/refineRun/deleteRun to their RPC methods', async () => {
    await client.getRun({ runId: 'run-1' });
    await client.approveRun({ runId: 'run-1' });
    await client.abortRun({ runId: 'run-1' });
    await client.refineRun({ runId: 'run-1', feedback: 'fb' });
    await client.deleteRun({ runId: 'run-1' });

    expect(handleRequest).toHaveBeenCalledWith('run.get', { runId: 'run-1' });
    expect(handleRequest).toHaveBeenCalledWith('run.approve', { runId: 'run-1' });
    expect(handleRequest).toHaveBeenCalledWith('run.abort', { runId: 'run-1' });
    expect(handleRequest).toHaveBeenCalledWith('run.refine', { runId: 'run-1', feedback: 'fb' });
    expect(handleRequest).toHaveBeenCalledWith('run.delete', { runId: 'run-1' });
  });

  it('forwards retryTask to run.retryTask with the payload', async () => {
    await client.retryTask({ runId: 'run-1', taskId: 'TASK-001', message: 'Try the v2 API.' });
    expect(handleRequest).toHaveBeenCalledWith('run.retryTask', {
      runId: 'run-1',
      taskId: 'TASK-001',
      message: 'Try the v2 API.',
    });
  });

  it('forwards getRunPlan, getConfig and setConfig', async () => {
    await client.getRunPlan({ runId: 'run-1' });
    await client.getConfig();
    await client.setConfig({ maxRetries: 3 });

    expect(handleRequest).toHaveBeenCalledWith('run.getPlan', { runId: 'run-1' });
    expect(handleRequest).toHaveBeenCalledWith('config.get', {});
    expect(handleRequest).toHaveBeenCalledWith('config.set', { maxRetries: 3 });
  });

  it('forwards getTaskFile to run.getTaskFile with the payload', async () => {
    await client.getTaskFile({ runId: 'run-1', file: 'task-1.md' });
    expect(handleRequest).toHaveBeenCalledWith('run.getTaskFile', {
      runId: 'run-1',
      file: 'task-1.md',
    });
  });

  it('forwards getRunEvents to run.getEvents with the payload', async () => {
    await client.getRunEvents({ runId: 'run-1' });
    expect(handleRequest).toHaveBeenCalledWith('run.getEvents', { runId: 'run-1' });
  });

  it('forwards shutdownDaemon to daemon.shutdown, defaulting to an empty payload', async () => {
    await client.shutdownDaemon();
    expect(handleRequest).toHaveBeenCalledWith('daemon.shutdown', {});
  });

  it('delivers broadcast events to onEvent handlers until unsubscribed', async () => {
    const received: unknown[] = [];
    const unsubscribe = client.onEvent((event) => received.push(event));

    handle.broadcast({ type: 'run:status-changed', runId: 'run-1', phase: 'done' });
    await vi.waitFor(() => expect(received).toHaveLength(1));

    unsubscribe();
    handle.broadcast({ type: 'run:status-changed', runId: 'run-1', phase: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toHaveLength(1);
  });
});
