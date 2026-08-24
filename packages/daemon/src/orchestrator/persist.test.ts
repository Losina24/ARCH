import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArchMeshEvent } from '@losina/ipc';
import type { RunMeta } from '@losina/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendRunEvent,
  getRunDir,
  loadPersistedRuns,
  loadRunEvents,
  persistRunMeta,
  removeRunDir,
} from './persist.js';

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

describe('persist', () => {
  let archDir: string;

  beforeEach(async () => {
    archDir = await mkdtemp(join(tmpdir(), 'arch-persist-test-'));
  });

  afterEach(async () => {
    await rm(archDir, { recursive: true, force: true });
  });

  it('computes the run directory as <archDir>/runs/<runId>', () => {
    expect(getRunDir(archDir, 'run-1')).toBe(join(archDir, 'runs', 'run-1'));
  });

  it('writes meta.json under the run directory, creating parent directories', async () => {
    const run = makeRun();
    await persistRunMeta(archDir, run);

    const written = JSON.parse(
      await readFile(join(getRunDir(archDir, run.runId), 'meta.json'), 'utf-8'),
    );
    expect(written).toEqual(run);
  });

  it('overwrites meta.json on a second call for the same run', async () => {
    const run = makeRun();
    await persistRunMeta(archDir, run);

    const updated = makeRun({ phase: 'implementation', updatedAt: '2026-08-14T01:00:00.000Z' });
    await persistRunMeta(archDir, updated);

    const written = JSON.parse(
      await readFile(join(getRunDir(archDir, run.runId), 'meta.json'), 'utf-8'),
    );
    expect(written.phase).toBe('implementation');
  });

  it('removes the run directory entirely via removeRunDir', async () => {
    const run = makeRun();
    await persistRunMeta(archDir, run);

    await removeRunDir(archDir, run.runId);

    await expect(access(getRunDir(archDir, run.runId))).rejects.toThrow();
  });

  it('does not throw when removing a run directory that never existed', async () => {
    await expect(removeRunDir(archDir, 'missing-run')).resolves.toBeUndefined();
  });
});

describe('loadPersistedRuns', () => {
  let archDir: string;

  beforeEach(async () => {
    archDir = await mkdtemp(join(tmpdir(), 'arch-persist-test-'));
  });

  afterEach(async () => {
    await rm(archDir, { recursive: true, force: true });
  });

  it('returns an empty array when no runs directory exists yet', async () => {
    expect(await loadPersistedRuns(archDir)).toEqual([]);
  });

  it('reads back every previously persisted run', async () => {
    const runA = makeRun({ runId: 'run-a' });
    const runB = makeRun({ runId: 'run-b', phase: 'implementation' });
    await persistRunMeta(archDir, runA);
    await persistRunMeta(archDir, runB);

    const loaded = await loadPersistedRuns(archDir);
    expect(loaded).toHaveLength(2);
    expect(loaded).toEqual(expect.arrayContaining([runA, runB]));
  });

  it('skips a run directory whose meta.json is missing or invalid, without failing the others', async () => {
    const goodRun = makeRun({ runId: 'run-good' });
    await persistRunMeta(archDir, goodRun);

    const emptyRunDir = getRunDir(archDir, 'run-empty');
    await mkdir(emptyRunDir, { recursive: true });

    const corruptRunDir = getRunDir(archDir, 'run-corrupt');
    await mkdir(corruptRunDir, { recursive: true });
    await writeFile(join(corruptRunDir, 'meta.json'), '{ "runId": "run-corrupt" }', 'utf-8');

    const loaded = await loadPersistedRuns(archDir);
    expect(loaded).toEqual([goodRun]);
  });
});

describe('appendRunEvent / loadRunEvents', () => {
  let archDir: string;

  beforeEach(async () => {
    archDir = await mkdtemp(join(tmpdir(), 'arch-persist-test-'));
  });

  afterEach(async () => {
    await rm(archDir, { recursive: true, force: true });
  });

  it('returns an empty array when no event log exists yet', async () => {
    expect(await loadRunEvents(archDir, 'run-1')).toEqual([]);
  });

  it('reads back every appended event with its timestamp, in order, creating parent directories as needed', async () => {
    const eventA: ArchMeshEvent = {
      type: 'run:status-changed',
      runId: 'run-1',
      phase: 'definition',
    };
    const eventB: ArchMeshEvent = {
      type: 'agent:activity',
      runId: 'run-1',
      agentId: 'agent-1',
      role: 'architect',
      state: 'thinking',
    };

    await appendRunEvent(archDir, eventA, 1000);
    await appendRunEvent(archDir, eventB, 2000);

    expect(await loadRunEvents(archDir, 'run-1')).toEqual([
      { event: eventA, timestamp: 1000 },
      { event: eventB, timestamp: 2000 },
    ]);
  });

  it('keeps event logs separate per run', async () => {
    const eventA: ArchMeshEvent = { type: 'run:status-changed', runId: 'run-a', phase: 'done' };
    const eventB: ArchMeshEvent = { type: 'run:status-changed', runId: 'run-b', phase: 'blocked' };

    await appendRunEvent(archDir, eventA, 1000);
    await appendRunEvent(archDir, eventB, 2000);

    expect(await loadRunEvents(archDir, 'run-a')).toEqual([{ event: eventA, timestamp: 1000 }]);
    expect(await loadRunEvents(archDir, 'run-b')).toEqual([{ event: eventB, timestamp: 2000 }]);
  });
});
