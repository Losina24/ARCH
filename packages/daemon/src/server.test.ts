import { mkdtemp, rm } from 'node:fs/promises';
import { type Socket, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DaemonServerHandle, startDaemonServer } from './server.js';

interface ResponseEnvelope {
  id: string;
  result?: unknown;
  error?: string;
}

function sendLine(socket: Socket, payload: unknown): void {
  socket.write(`${JSON.stringify(payload)}\n`);
}

function readOneLine(socket: Socket): Promise<ResponseEnvelope> {
  return new Promise((resolve) => {
    socket.once('data', (chunk: Buffer) => {
      resolve(JSON.parse(chunk.toString('utf-8').trim()) as ResponseEnvelope);
    });
  });
}

async function connectSocket(socketPath: string): Promise<Socket> {
  const socket = connect(socketPath);
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  return socket;
}

describe('startDaemonServer', () => {
  let dir: string;
  let socketPath: string;
  let handle: DaemonServerHandle | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arch-server-test-'));
    // Real AF_UNIX sockets can fail to bind on Windows (EACCES) regardless of directory
    // permissions — named pipes are the platform's native, reliable local-IPC mechanism.
    socketPath =
      process.platform === 'win32' ? `\\\\.\\pipe\\${basename(dir)}` : join(dir, 'daemon.sock');
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('routes a request line to handleRequest and writes back its result', async () => {
    const handleRequest = vi.fn(async (method: string, payload: unknown) => ({
      method,
      payload,
    }));
    handle = await startDaemonServer(socketPath, handleRequest);

    const socket = await connectSocket(socketPath);
    sendLine(socket, { id: 'req-1', method: 'run.list', payload: { foo: 'bar' } });
    const response = await readOneLine(socket);

    expect(handleRequest).toHaveBeenCalledWith('run.list', { foo: 'bar' });
    expect(response).toEqual({
      id: 'req-1',
      result: { method: 'run.list', payload: { foo: 'bar' } },
    });
    socket.end();
  });

  it('writes back an error field when handleRequest rejects', async () => {
    handle = await startDaemonServer(socketPath, async () => {
      throw new Error('boom');
    });

    const socket = await connectSocket(socketPath);
    sendLine(socket, { id: 'req-1', method: 'whatever', payload: {} });
    const response = await readOneLine(socket);

    expect(response).toEqual({ id: 'req-1', error: 'boom' });
    socket.end();
  });

  it('broadcasts an event to every connected socket', async () => {
    const onClientCountChange = vi.fn();
    handle = await startDaemonServer(socketPath, async () => ({}), { onClientCountChange });

    const socketA = await connectSocket(socketPath);
    const socketB = await connectSocket(socketPath);
    // A client's own 'connect' event can resolve before the server has registered it (the two
    // sides aren't synchronous over a Windows named pipe the way they are over a Unix socket) —
    // wait for the server's own bookkeeping so the broadcast below isn't sent to an empty set.
    await vi.waitFor(() => expect(onClientCountChange).toHaveBeenLastCalledWith(2));

    const eventA = readOneLine(socketA);
    const eventB = readOneLine(socketB);
    handle.broadcast({ type: 'run:status-changed', runId: 'run-1', phase: 'done' });

    expect(await eventA).toEqual({
      event: { type: 'run:status-changed', runId: 'run-1', phase: 'done' },
    });
    expect(await eventB).toEqual({
      event: { type: 'run:status-changed', runId: 'run-1', phase: 'done' },
    });
    socketA.end();
    socketB.end();
  });

  it('survives a client disconnect racing with a broadcast', async () => {
    const onClientCountChange = vi.fn();
    handle = await startDaemonServer(socketPath, async () => ({}), { onClientCountChange });

    const disconnected = await connectSocket(socketPath);
    const connected = await connectSocket(socketPath);
    // See the comment in the broadcast test above: wait for the server to have registered both
    // clients before tearing one down, or the broadcast below can race the server's bookkeeping.
    await vi.waitFor(() => expect(onClientCountChange).toHaveBeenLastCalledWith(2));
    const event = readOneLine(connected);

    disconnected.destroy();
    expect(() =>
      handle?.broadcast({ type: 'run:status-changed', runId: 'run-1', phase: 'done' }),
    ).not.toThrow();

    expect(await event).toEqual({
      event: { type: 'run:status-changed', runId: 'run-1', phase: 'done' },
    });
    await vi.waitFor(() => expect(onClientCountChange).toHaveBeenLastCalledWith(1));
    connected.end();
  });

  it('reports the connected client count on every connect and disconnect', async () => {
    const onClientCountChange = vi.fn();
    handle = await startDaemonServer(socketPath, async () => ({}), { onClientCountChange });

    const socketA = await connectSocket(socketPath);
    await vi.waitFor(() => expect(onClientCountChange).toHaveBeenLastCalledWith(1));

    const socketB = await connectSocket(socketPath);
    await vi.waitFor(() => expect(onClientCountChange).toHaveBeenLastCalledWith(2));

    socketA.end();
    await vi.waitFor(() => expect(onClientCountChange).toHaveBeenLastCalledWith(1));

    socketB.end();
    await vi.waitFor(() => expect(onClientCountChange).toHaveBeenLastCalledWith(0));
  });

  it('refuses new connections once closed', async () => {
    handle = await startDaemonServer(socketPath, async () => ({}));
    await handle.close();
    handle = undefined;

    const error = await new Promise<Error | undefined>((resolve) => {
      const socket = connect(socketPath);
      socket.once('error', (err) => resolve(err));
      socket.once('connect', () => resolve(undefined));
    });

    expect(error).toBeDefined();
  });
});
