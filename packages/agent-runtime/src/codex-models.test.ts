import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));

const { listCodexModels } = await import('./codex-models.js');

interface FakeAppServer {
  child: EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  requests: Array<Record<string, unknown>>;
}

function fakeAppServer(
  respond: (request: Record<string, unknown>, stdout: PassThrough) => void,
): FakeAppServer {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const requests: Array<Record<string, unknown>> = [];
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    kill: vi.fn(() => true),
  });
  let buffered = '';

  stdin.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const request = JSON.parse(line) as Record<string, unknown>;
      requests.push(request);
      respond(request, stdout);
    }
  });
  spawn.mockReturnValue(child);
  return { child, requests };
}

function writeResponse(stdout: PassThrough, response: unknown): void {
  queueMicrotask(() => stdout.write(`${JSON.stringify(response)}\n`));
}

describe('listCodexModels', () => {
  beforeEach(() => {
    spawn.mockReset();
  });

  it('performs the app-server handshake and returns picker-visible model ids', async () => {
    const server = fakeAppServer((request, stdout) => {
      if (request.id === 0) {
        writeResponse(stdout, { id: 0, result: { userAgent: 'Codex' } });
      } else if (request.id === 1) {
        writeResponse(stdout, {
          id: 1,
          result: {
            data: [
              { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol' },
              { id: 'gpt-5.6-terra' },
              { id: 'duplicate', model: 'gpt-5.6-sol' },
              { id: '' },
            ],
            nextCursor: null,
          },
        });
      }
    });

    await expect(listCodexModels()).resolves.toEqual(['gpt-5.6-sol', 'gpt-5.6-terra']);
    expect(spawn).toHaveBeenCalledWith('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    expect(server.requests.map((request) => request.method)).toEqual([
      'initialize',
      'initialized',
      'model/list',
    ]);
    expect(server.child.kill).toHaveBeenCalledTimes(1);
  });

  it('follows model/list pagination', async () => {
    const server = fakeAppServer((request, stdout) => {
      if (request.id === 0) {
        writeResponse(stdout, { id: 0, result: {} });
      } else if (request.id === 1) {
        writeResponse(stdout, {
          id: 1,
          result: { data: [{ model: 'gpt-5.6-sol' }], nextCursor: 'page-2' },
        });
      } else if (request.id === 2) {
        writeResponse(stdout, {
          id: 2,
          result: { data: [{ model: 'gpt-5.6-luna' }], nextCursor: null },
        });
      }
    });

    await expect(listCodexModels()).resolves.toEqual(['gpt-5.6-sol', 'gpt-5.6-luna']);
    expect(server.requests.at(-1)?.params).toMatchObject({ cursor: 'page-2' });
  });

  it('returns an empty list when the CLI cannot start', async () => {
    const server = fakeAppServer(() => {});
    const result = listCodexModels();
    server.child.emit('error', new Error('spawn ENOENT'));

    await expect(result).resolves.toEqual([]);
  });

  it('returns an empty list when app-server rejects model/list', async () => {
    fakeAppServer((request, stdout) => {
      if (request.id === 0) writeResponse(stdout, { id: 0, result: {} });
      if (request.id === 1) {
        writeResponse(stdout, { id: 1, error: { message: 'not authenticated' } });
      }
    });

    await expect(listCodexModels()).resolves.toEqual([]);
  });
});
