import { mkdtemp, rm } from 'node:fs/promises';
import { type Server, type Socket, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonRpcClient } from './rpc-client.js';

interface RequestEnvelope {
  id: string;
  method: string;
  payload: unknown;
}

describe('DaemonRpcClient', () => {
  let dir: string;
  let socketPath: string;
  let server: Server;
  let serverSockets: Socket[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arch-rpc-client-test-'));
    // Real AF_UNIX sockets can fail to bind on Windows (EACCES) regardless of directory
    // permissions — named pipes are the platform's native, reliable local-IPC mechanism.
    socketPath =
      process.platform === 'win32' ? `\\\\.\\pipe\\${basename(dir)}` : join(dir, 'daemon.sock');
    serverSockets = [];
    server = createServer((socket) => {
      serverSockets.push(socket);
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  // A client's own 'connect' event can resolve before the server has accepted it (the two sides
  // aren't synchronous over a Windows named pipe the way they are over a Unix socket) — every
  // test below reaches into `serverSockets[0]` right after connecting, so wait for the server to
  // have actually registered it first.
  async function connectClient(): Promise<DaemonRpcClient> {
    const client = await DaemonRpcClient.connect(socketPath);
    await vi.waitFor(() => expect(serverSockets.length).toBeGreaterThan(0));
    return client;
  }

  function nextRequest(socket: Socket): Promise<RequestEnvelope> {
    return new Promise((resolve) => {
      socket.once('data', (chunk: Buffer) => {
        resolve(JSON.parse(chunk.toString('utf-8').trim()) as RequestEnvelope);
      });
    });
  }

  it('sends id/method/payload and resolves the matching result', async () => {
    const client = await connectClient();
    const requestPromise = client.request('run.list', { foo: 'bar' });

    const line = await nextRequest(serverSockets[0] as Socket);
    expect(line.method).toBe('run.list');
    expect(line.payload).toEqual({ foo: 'bar' });

    (serverSockets[0] as Socket).write(
      `${JSON.stringify({ id: line.id, result: { ok: true } })}\n`,
    );
    expect(await requestPromise).toEqual({ ok: true });
    client.close();
  });

  it('rejects the pending request when the response carries an error', async () => {
    const client = await connectClient();
    const requestPromise = client.request('run.get', { runId: 'missing' });

    const line = await nextRequest(serverSockets[0] as Socket);
    (serverSockets[0] as Socket).write(
      `${JSON.stringify({ id: line.id, error: 'Run not found: missing' })}\n`,
    );

    await expect(requestPromise).rejects.toThrow('Run not found: missing');
    client.close();
  });

  it('correlates concurrent requests by id, independent of response order', async () => {
    const client = await connectClient();
    const p1 = client.request('a', {});
    const p2 = client.request('b', {});

    const lines: RequestEnvelope[] = [];
    await new Promise<void>((resolve) => {
      let buffer = '';
      (serverSockets[0] as Socket).on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        let index = buffer.indexOf('\n');
        while (index !== -1) {
          lines.push(JSON.parse(buffer.slice(0, index)) as RequestEnvelope);
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf('\n');
          if (lines.length === 2) resolve();
        }
      });
    });

    (serverSockets[0] as Socket).write(
      `${JSON.stringify({ id: lines[1]?.id, result: 'second' })}\n`,
    );
    (serverSockets[0] as Socket).write(
      `${JSON.stringify({ id: lines[0]?.id, result: 'first' })}\n`,
    );

    expect(await p1).toBe('first');
    expect(await p2).toBe('second');
    client.close();
  });

  it('dispatches event lines to registered handlers until unsubscribed', async () => {
    const client = await connectClient();
    const received: unknown[] = [];
    const unsubscribe = client.onEvent((event) => received.push(event));

    const event = { type: 'run:status-changed', runId: 'run-1', phase: 'done' };
    (serverSockets[0] as Socket).write(`${JSON.stringify({ event })}\n`);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual(event);

    unsubscribe();
    (serverSockets[0] as Socket).write(`${JSON.stringify({ event })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toHaveLength(1);

    client.close();
  });

  it('rejects pending requests when the connection closes before a response arrives', async () => {
    const client = await connectClient();
    const requestPromise = client.request('daemon.shutdown', {});

    await nextRequest(serverSockets[0] as Socket);
    (serverSockets[0] as Socket).destroy();

    await expect(requestPromise).rejects.toThrow('Daemon connection closed');
  });

  it('parses multiple lines delivered in a single chunk', async () => {
    const client = await connectClient();
    const received: unknown[] = [];
    client.onEvent((event) => received.push(event));

    const eventA = { type: 'run:status-changed', runId: 'run-1', phase: 'implementation' };
    const eventB = { type: 'run:status-changed', runId: 'run-1', phase: 'done' };
    (serverSockets[0] as Socket).write(
      `${JSON.stringify({ event: eventA })}\n${JSON.stringify({ event: eventB })}\n`,
    );

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received).toEqual([eventA, eventB]);
    client.close();
  });
});
