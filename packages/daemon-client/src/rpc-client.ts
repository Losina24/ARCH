import { randomUUID } from 'node:crypto';
import { type Socket, connect } from 'node:net';
import type { ArchMeshEvent } from '@arch/ipc';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface ResponseEnvelope {
  id: string;
  result?: unknown;
  error?: string;
}

interface EventEnvelope {
  event: ArchMeshEvent;
}

export type EventHandler = (event: ArchMeshEvent) => void;

export class DaemonRpcClient {
  private buffer = '';
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventHandlers = new Set<EventHandler>();

  private constructor(private readonly socket: Socket) {
    this.socket.on('data', (chunk: Buffer) => this.handleData(chunk));
    // Without this, a request left pending when the daemon closes the
    // connection (e.g. it exits right after answering daemon.shutdown) would
    // never resolve or reject, hanging its caller forever.
    this.socket.on('close', () => this.rejectAllPending(new Error('Daemon connection closed')));
  }

  static async connect(socketPath: string): Promise<DaemonRpcClient> {
    const socket = connect(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    return new DaemonRpcClient(socket);
  }

  async request<T>(method: string, payload: unknown): Promise<T> {
    const id = randomUUID();
    const line = `${JSON.stringify({ id, method, payload })}\n`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.write(line);
    });
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  close(): void {
    this.socket.end();
  }

  private rejectAllPending(reason: Error): void {
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8');
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.trim()) this.handleLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    const parsed = JSON.parse(line) as ResponseEnvelope | EventEnvelope;
    if ('event' in parsed) {
      for (const handler of this.eventHandlers) handler(parsed.event);
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    if (parsed.error) {
      pending.reject(new Error(parsed.error));
    } else {
      pending.resolve(parsed.result);
    }
  }
}
