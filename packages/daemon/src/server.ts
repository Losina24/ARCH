import { unlink } from 'node:fs/promises';
import { type Socket, createServer } from 'node:net';
import type { ArchMeshEvent } from '@arch/ipc';

export type RequestHandler = (method: string, payload: unknown) => Promise<unknown>;

export interface DaemonServerHandle {
  broadcast(event: ArchMeshEvent): void;
  close(): Promise<void>;
}

interface RpcEnvelope {
  id: string;
  method: string;
  payload: unknown;
}

async function handleLine(socket: Socket, line: string, handleRequest: RequestHandler) {
  const { id, method, payload } = JSON.parse(line) as RpcEnvelope;
  try {
    const result = await handleRequest(method, payload);
    socket.write(`${JSON.stringify({ id, result })}\n`);
  } catch (error) {
    socket.write(`${JSON.stringify({ id, error: (error as Error).message })}\n`);
  }
}

export interface StartDaemonServerOptions {
  /** Called with the new connected-socket count on every connect/disconnect. */
  onClientCountChange?: (count: number) => void;
}

export async function startDaemonServer(
  socketPath: string,
  handleRequest: RequestHandler,
  options: StartDaemonServerOptions = {},
): Promise<DaemonServerHandle> {
  const { onClientCountChange } = options;
  await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });

  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    onClientCountChange?.(sockets.size);
    socket.once('close', () => {
      sockets.delete(socket);
      onClientCountChange?.(sockets.size);
    });

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim()) {
          void handleLine(socket, line, handleRequest);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });

  return {
    broadcast(event) {
      const line = `${JSON.stringify({ event })}\n`;
      for (const socket of sockets) {
        socket.write(line);
      }
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
