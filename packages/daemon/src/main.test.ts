import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { type Socket, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getArchPaths } from '@losina/config';
import { loadTasksIndex, saveTasksIndex } from '@losina/core';
import type { RunMeta, Task } from '@losina/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDaemon } from './main.js';
import { getRunDir, persistRunMeta } from './orchestrator/persist.js';
import type { DaemonServerHandle } from './server.js';

interface ResponseEnvelope {
  id: string;
  result?: unknown;
  error?: string;
}

async function connectSocket(socketPath: string): Promise<Socket> {
  const socket = connect(socketPath);
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  return socket;
}

let requestCounter = 0;

// Responses share the wire with broadcast events (`{event}` lines with no `id`), and several
// lines can arrive combined in a single 'data' chunk. Each socket gets one persistent buffered
// line reader that dispatches parsed responses to the resolver waiting on their `id`; broadcast
// lines and lines for another in-flight request are simply left for their own resolver (or
// ignored, for broadcasts).
const socketResolvers = new WeakMap<Socket, Map<string, (envelope: ResponseEnvelope) => void>>();

function ensureLineReader(socket: Socket): Map<string, (envelope: ResponseEnvelope) => void> {
  const existing = socketResolvers.get(socket);
  if (existing) return existing;

  const resolvers = new Map<string, (envelope: ResponseEnvelope) => void>();
  socketResolvers.set(socket, resolvers);

  let buffer = '';
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as ResponseEnvelope & { event?: unknown };
      const resolve = parsed.id ? resolvers.get(parsed.id) : undefined;
      if (resolve) {
        resolvers.delete(parsed.id);
        resolve(parsed);
      }
    }
  });

  return resolvers;
}

function rpc(socket: Socket, method: string, payload: unknown = {}): Promise<unknown> {
  const id = `req-${requestCounter++}`;
  const resolvers = ensureLineReader(socket);
  const response = new Promise<ResponseEnvelope>((resolve) => {
    resolvers.set(id, resolve);
  });
  socket.write(`${JSON.stringify({ id, method, payload })}\n`);
  return response.then((envelope) => {
    if (envelope.error) throw new Error(envelope.error);
    return envelope.result;
  });
}

function makeRun(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    runId: 'run-1',
    title: 'Add add(a, b)',
    prompt: 'Add a function that sums two numbers',
    cwd: '/tmp/project',
    phase: 'definition',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-001',
    title: 'Do something',
    status: 'failed',
    dependsOn: [],
    file: 'tasks/TASK-001.md',
    correctionFiles: ['tasks/TASK-001.corrections.1.md'],
    retries: 2,
    checks: [],
    scope: [],
    failureReason: 'It broke',
    ...overrides,
  };
}

describe('startDaemon', () => {
  let cwd: string;
  let homeDir: string;
  let handle: DaemonServerHandle | undefined;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'arch-main-test-'));
    // archDir/socketPath now live under ~/.arch (os.homedir() reads $HOME on POSIX,
    // %USERPROFILE% on Windows) — stub both so these tests never touch the real developer
    // machine's ~/.arch.
    homeDir = await mkdtemp(join(tmpdir(), 'arch-main-test-home-'));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy();
    await handle?.close().catch(() => {});
    handle = undefined;
    await rm(cwd, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  it("flips a run orphaned mid-'implementation' by a previous daemon to 'blocked' on startup", async () => {
    const { archDir, socketPath } = getArchPaths(cwd);
    const orphan = makeRun({ runId: 'run-orphan', phase: 'implementation' });
    await persistRunMeta(archDir, orphan);

    handle = await startDaemon(cwd);
    const socket = await connectSocket(socketPath);
    sockets.push(socket);

    const run = (await rpc(socket, 'run.get', { runId: 'run-orphan' })) as RunMeta;
    expect(run.phase).toBe('blocked');

    const onDisk = JSON.parse(
      await readFile(join(getRunDir(archDir, 'run-orphan'), 'meta.json'), 'utf-8'),
    );
    expect(onDisk.phase).toBe('blocked');
  });

  it('leaves a definition-phase run untouched on startup', async () => {
    const { archDir, socketPath } = getArchPaths(cwd);
    await persistRunMeta(archDir, makeRun({ runId: 'run-def', phase: 'definition' }));

    handle = await startDaemon(cwd);
    const socket = await connectSocket(socketPath);
    sockets.push(socket);

    const run = (await rpc(socket, 'run.get', { runId: 'run-def' })) as RunMeta;
    expect(run.phase).toBe('definition');
  });

  describe('run.retryTask', () => {
    it('resets the failed task and any blocked siblings to pending, and flips the run to implementation', async () => {
      const { archDir, socketPath } = getArchPaths(cwd);
      const run = makeRun({ runId: 'run-retry', phase: 'blocked' });
      await persistRunMeta(archDir, run);

      const tasksIndexPath = join(getRunDir(archDir, run.runId), 'tasks-index.yaml');
      await saveTasksIndex(tasksIndexPath, {
        tasks: [
          makeTask({ id: 'TASK-001', status: 'failed' }),
          makeTask({
            id: 'TASK-002',
            status: 'blocked',
            dependsOn: ['TASK-001'],
            retries: 0,
            correctionFiles: [],
            failureReason: undefined,
          }),
          makeTask({
            id: 'TASK-003',
            status: 'done',
            retries: 0,
            correctionFiles: [],
            failureReason: undefined,
          }),
        ],
      });

      handle = await startDaemon(cwd);
      const socket = await connectSocket(socketPath);
      sockets.push(socket);

      const updated = (await rpc(socket, 'run.retryTask', {
        runId: run.runId,
        taskId: 'TASK-001',
        message: 'Try using the v2 API instead.',
      })) as RunMeta;
      expect(updated.phase).toBe('implementation');

      // The RPC handler kicks off a fresh implementation-phase loop in the background
      // (fire-and-forget); abort it right away so it never gets a chance to dispatch the
      // task it just reset and race the assertions below.
      await rpc(socket, 'run.abort', { runId: run.runId });

      const onDiskMeta = JSON.parse(
        await readFile(join(getRunDir(archDir, run.runId), 'meta.json'), 'utf-8'),
      );
      expect(onDiskMeta.phase).toBe('implementation');

      const onDiskTasks = await loadTasksIndex(tasksIndexPath);
      const [task1, task2, task3] = onDiskTasks.tasks;
      expect(task1).toMatchObject({
        id: 'TASK-001',
        status: 'pending',
        retries: 0,
        correctionFiles: [],
      });
      expect(task1?.failureReason).toBeUndefined();
      expect(task2).toMatchObject({ id: 'TASK-002', status: 'pending' });
      expect(task3).toMatchObject({ id: 'TASK-003', status: 'done' });
    });

    it('resets an awaiting_human task to pending, same as a failed task', async () => {
      const { archDir, socketPath } = getArchPaths(cwd);
      const run = makeRun({ runId: 'run-retry-awaiting-human', phase: 'blocked' });
      await persistRunMeta(archDir, run);

      const tasksIndexPath = join(getRunDir(archDir, run.runId), 'tasks-index.yaml');
      await saveTasksIndex(tasksIndexPath, {
        tasks: [makeTask({ id: 'TASK-001', status: 'awaiting_human' })],
      });

      handle = await startDaemon(cwd);
      const socket = await connectSocket(socketPath);
      sockets.push(socket);

      const updated = (await rpc(socket, 'run.retryTask', {
        runId: run.runId,
        taskId: 'TASK-001',
        message: 'Permission granted, please retry.',
      })) as RunMeta;
      expect(updated.phase).toBe('implementation');

      await rpc(socket, 'run.abort', { runId: run.runId });

      const onDiskTasks = await loadTasksIndex(tasksIndexPath);
      expect(onDiskTasks.tasks[0]).toMatchObject({
        id: 'TASK-001',
        status: 'pending',
        retries: 0,
        correctionFiles: [],
      });
    });

    it('broadcasts a human:prompt-sent event addressed to the task worker agent', async () => {
      const { archDir, socketPath } = getArchPaths(cwd);
      const run = makeRun({ runId: 'run-retry-broadcast', phase: 'blocked' });
      await persistRunMeta(archDir, run);

      const tasksIndexPath = join(getRunDir(archDir, run.runId), 'tasks-index.yaml');
      await saveTasksIndex(tasksIndexPath, {
        tasks: [makeTask({ id: 'TASK-001', status: 'failed' })],
      });

      handle = await startDaemon(cwd);
      const socket = await connectSocket(socketPath);
      sockets.push(socket);

      await rpc(socket, 'run.retryTask', {
        runId: run.runId,
        taskId: 'TASK-001',
        message: 'Try using the v2 API instead.',
      });
      await rpc(socket, 'run.abort', { runId: run.runId });

      const events = await vi.waitFor(async () => {
        const result = (await rpc(socket, 'run.getEvents', { runId: run.runId })) as Array<{
          event: { type: string };
        }>;
        expect(result.some((entry) => entry.event.type === 'human:prompt-sent')).toBe(true);
        return result;
      });

      const promptSent = events.find((entry) => entry.event.type === 'human:prompt-sent');
      expect(promptSent?.event).toMatchObject({
        type: 'human:prompt-sent',
        runId: run.runId,
        taskId: 'TASK-001',
        agentId: 'worker-TASK-001',
        text: 'Try using the v2 API instead.',
      });
    });

    it('rejects retrying a task that is not failed', async () => {
      const { archDir, socketPath } = getArchPaths(cwd);
      const run = makeRun({ runId: 'run-retry-bad-status', phase: 'blocked' });
      await persistRunMeta(archDir, run);

      const tasksIndexPath = join(getRunDir(archDir, run.runId), 'tasks-index.yaml');
      await saveTasksIndex(tasksIndexPath, {
        tasks: [makeTask({ id: 'TASK-001', status: 'done' })],
      });

      handle = await startDaemon(cwd);
      const socket = await connectSocket(socketPath);
      sockets.push(socket);

      await expect(
        rpc(socket, 'run.retryTask', { runId: run.runId, taskId: 'TASK-001', message: 'note' }),
      ).rejects.toThrow('not failed');
    });

    it('rejects retrying a task on a run that has not started implementation yet', async () => {
      const { archDir, socketPath } = getArchPaths(cwd);
      const run = makeRun({ runId: 'run-retry-not-blocked', phase: 'definition' });
      await persistRunMeta(archDir, run);

      const tasksIndexPath = join(getRunDir(archDir, run.runId), 'tasks-index.yaml');
      await saveTasksIndex(tasksIndexPath, {
        tasks: [makeTask({ id: 'TASK-001', status: 'failed' })],
      });

      handle = await startDaemon(cwd);
      const socket = await connectSocket(socketPath);
      sockets.push(socket);

      await expect(
        rpc(socket, 'run.retryTask', { runId: run.runId, taskId: 'TASK-001', message: 'note' }),
      ).rejects.toThrow('not in progress');
    });
  });

  describe('run.getEvents', () => {
    it('persists broadcast events to disk and returns them with timestamps', async () => {
      const { archDir, socketPath } = getArchPaths(cwd);
      const run = makeRun({ runId: 'run-events', phase: 'blocked' });
      await persistRunMeta(archDir, run);

      const tasksIndexPath = join(getRunDir(archDir, run.runId), 'tasks-index.yaml');
      await saveTasksIndex(tasksIndexPath, {
        tasks: [makeTask({ id: 'TASK-001', status: 'failed' })],
      });

      handle = await startDaemon(cwd);
      const socket = await connectSocket(socketPath);
      sockets.push(socket);

      // run.retryTask broadcasts a task:status-changed and a run:status-changed event for
      // this run as a side effect; abort right away so the background implementation loop it
      // kicks off doesn't race these assertions with events of its own.
      await rpc(socket, 'run.retryTask', {
        runId: run.runId,
        taskId: 'TASK-001',
        message: 'Try using the v2 API instead.',
      });
      await rpc(socket, 'run.abort', { runId: run.runId });

      // The write is enqueued fire-and-forget from the broadcast wrapper, so both events can
      // still be in flight (or arrive one at a time) when the RPC responses above return —
      // poll until both have landed on disk.
      const events = await vi.waitFor(async () => {
        const result = (await rpc(socket, 'run.getEvents', { runId: run.runId })) as Array<{
          event: { type: string };
          timestamp: number;
        }>;
        expect(result.some((entry) => entry.event.type === 'task:status-changed')).toBe(true);
        expect(result.some((entry) => entry.event.type === 'run:status-changed')).toBe(true);
        return result;
      });

      expect(events.every((entry) => typeof entry.timestamp === 'number')).toBe(true);
    });

    it('rejects for a run that does not exist', async () => {
      const { socketPath } = getArchPaths(cwd);
      handle = await startDaemon(cwd);
      const socket = await connectSocket(socketPath);
      sockets.push(socket);

      await expect(rpc(socket, 'run.getEvents', { runId: 'missing-run' })).rejects.toThrow(
        'Run not found',
      );
    });
  });

  describe('idle shutdown', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.useFakeTimers();
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    });

    afterEach(() => {
      exitSpy.mockRestore();
      vi.useRealTimers();
    });

    it('self-terminates after the grace period once the last client disconnects with no active work', async () => {
      const { socketPath } = getArchPaths(cwd);
      handle = await startDaemon(cwd);
      const socket = await connectSocket(socketPath);
      await rpc(socket, 'run.list');
      const closed = new Promise<void>((resolve) => socket.once('close', resolve));
      socket.end();
      await closed;

      await vi.advanceTimersByTimeAsync(10_000);

      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('does not self-terminate while a client stays connected', async () => {
      const { socketPath } = getArchPaths(cwd);
      handle = await startDaemon(cwd);
      const socket = await connectSocket(socketPath);
      sockets.push(socket);
      await rpc(socket, 'run.list');

      await vi.advanceTimersByTimeAsync(10_000);

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('cancels the pending shutdown when a new client reconnects before the grace period elapses', async () => {
      const { socketPath } = getArchPaths(cwd);
      handle = await startDaemon(cwd);
      const socket = await connectSocket(socketPath);
      await rpc(socket, 'run.list');
      const closed = new Promise<void>((resolve) => socket.once('close', resolve));
      socket.end();
      await closed;

      await vi.advanceTimersByTimeAsync(5_000);
      const reconnected = await connectSocket(socketPath);
      sockets.push(reconnected);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});
