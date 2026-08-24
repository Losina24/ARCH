import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchMeshEvent, PersistedRunEvent } from '@losina/ipc';
import { type RunMeta, RunMetaSchema } from '@losina/schemas';

export function getRunDir(archDir: string, runId: string): string {
  return join(archDir, 'runs', runId);
}

export async function persistRunMeta(archDir: string, run: RunMeta): Promise<void> {
  const runDir = getRunDir(archDir, run.runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'meta.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf-8');
}

export async function removeRunDir(archDir: string, runId: string): Promise<void> {
  await rm(getRunDir(archDir, runId), { recursive: true, force: true });
}

/**
 * Reads back every run previously persisted via persistRunMeta, so a fresh
 * daemon process (e.g. after a restart) can repopulate its in-memory
 * RunManager instead of treating existing runs as unknown. Skips entries
 * that are missing or fail to parse, since RunManager is otherwise the only
 * source of truth and a single corrupt run directory shouldn't block startup.
 */
export async function loadPersistedRuns(archDir: string): Promise<RunMeta[]> {
  const runsDir = join(archDir, 'runs');
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const runs: RunMeta[] = [];
  for (const runId of entries) {
    try {
      const raw = await readFile(join(runsDir, runId, 'meta.json'), 'utf-8');
      runs.push(RunMetaSchema.parse(JSON.parse(raw)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      console.error(`[daemon] skipping unreadable run meta for ${runId}:`, error);
    }
  }
  return runs;
}

/**
 * Appends one event as an NDJSON line to this run's event log. The in-memory RunEventBus/
 * broadcast path has no history — a client that connects (or a view that mounts) after an event
 * already fired never sees it — so this is the durable side of every broadcast, letting a fresh
 * subscriber reconstruct what already happened via loadRunEvents before it starts listening live.
 */
export async function appendRunEvent(
  archDir: string,
  event: ArchMeshEvent,
  timestamp: number,
): Promise<void> {
  const runDir = getRunDir(archDir, event.runId);
  await mkdir(runDir, { recursive: true });
  const record: PersistedRunEvent = { event, timestamp };
  await appendFile(join(runDir, 'events.ndjson'), `${JSON.stringify(record)}\n`, 'utf-8');
}

/** Reads back every event previously persisted via appendRunEvent, in the order they occurred. */
export async function loadRunEvents(archDir: string, runId: string): Promise<PersistedRunEvent[]> {
  let raw: string;
  try {
    raw = await readFile(join(getRunDir(archDir, runId), 'events.ndjson'), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as PersistedRunEvent);
}
