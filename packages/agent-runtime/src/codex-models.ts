import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const LIST_TIMEOUT_MS = 5000;
const PAGE_SIZE = 100;

interface AppServerResponse {
  id?: number;
  result?: unknown;
  error?: unknown;
}

interface ModelListResult {
  data?: unknown;
  nextCursor?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function parseModelListResult(value: unknown): { models: string[]; nextCursor?: string } | null {
  const result = asRecord(value) as ModelListResult | null;
  if (!result || !Array.isArray(result.data)) return null;

  const models = result.data.flatMap((entry) => {
    const model = asRecord(entry);
    if (!model) return [];
    const id =
      typeof model.model === 'string'
        ? model.model.trim()
        : typeof model.id === 'string'
          ? model.id.trim()
          : '';
    return id.length > 0 ? [id] : [];
  });
  const nextCursor =
    typeof result.nextCursor === 'string' && result.nextCursor.length > 0
      ? result.nextCursor
      : undefined;

  return { models, nextCursor };
}

/**
 * Returns the picker-visible models exposed by the installed Codex CLI for the current account.
 * Codex's app-server owns this catalog, so querying `model/list` avoids shipping a model picker
 * that becomes stale every time OpenAI changes availability. An empty list lets the UI use its
 * current-model fallback when the CLI is missing, too old, unauthenticated, or fails to respond.
 */
export async function listCodexModels(): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const lines = createInterface({ input: child.stdout });
    const models: string[] = [];
    let settled = false;
    let modelRequestId = 1;

    const finish = (result: string[] = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      child.stdin.end();
      child.kill();
      resolve(result);
    };

    const send = (message: unknown): boolean => {
      if (settled || child.stdin.destroyed) return false;
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
        return true;
      } catch {
        finish();
        return false;
      }
    };

    const requestModels = (cursor?: string) => {
      send({
        method: 'model/list',
        id: modelRequestId,
        params: {
          limit: PAGE_SIZE,
          includeHidden: false,
          ...(cursor ? { cursor } : {}),
        },
      });
    };

    child.once('error', () => finish());
    child.once('exit', () => finish());
    child.stdin.once('error', () => finish());

    lines.on('line', (line) => {
      let response: AppServerResponse;
      try {
        response = JSON.parse(line) as AppServerResponse;
      } catch {
        return;
      }

      if (response.id === 0) {
        if (response.error !== undefined) {
          finish();
          return;
        }
        send({ method: 'initialized', params: {} });
        requestModels();
        return;
      }

      if (response.id !== modelRequestId) return;
      if (response.error !== undefined) {
        finish();
        return;
      }

      const page = parseModelListResult(response.result);
      if (!page) {
        finish();
        return;
      }
      models.push(...page.models);
      if (page.nextCursor) {
        modelRequestId += 1;
        requestModels(page.nextCursor);
        return;
      }
      finish([...new Set(models)]);
    });

    const timeout = setTimeout(() => finish(), LIST_TIMEOUT_MS);
    send({
      method: 'initialize',
      id: 0,
      params: {
        clientInfo: {
          name: 'arch',
          title: 'ARCH',
          version: '0.1.1',
        },
      },
    });
  });
}
