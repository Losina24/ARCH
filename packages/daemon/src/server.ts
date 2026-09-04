import { unlink } from 'node:fs/promises';
import { type Socket, createServer } from 'node:net';
import type { ArchMeshEvent } from '@losina/ipc';

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
  // Windows named pipes (\\.\pipe\...) aren't filesystem entries — there's nothing to unlink,
  // and the OS reclaims the name once no server holds it open.
  if (!socketPath.startsWith('\\\\.\\pipe\\')) {
    await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  const sockets = new Set<Socket>();

  const removeSocket = (socket: Socket) => {
    if (!sockets.delete(socket)) return;
    onClientCountChange?.(sockets.size);
  };

  const server = createServer((socket) => {
    sockets.add(socket);
    onClientCountChange?.(sockets.size);
    socket.once('close', () => removeSocket(socket));
    socket.on('error', () => {
      // A client may disappear between an activity event being queued and broadcast writing it.
      // Treat EPIPE/ECONNRESET as a disconnect so frequent progress updates cannot crash daemon.
      removeSocket(socket);
      socket.destroy();
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
        if (socket.destroyed || !socket.writable) {
          removeSocket(socket);
          continue;
        }
        try {
          socket.write(line);
        } catch {
          removeSocket(socket);
          socket.destroy();
        }
      }
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
