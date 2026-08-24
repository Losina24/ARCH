import { setTimeout as delay } from 'node:timers/promises';
import type { RunMeta } from '@losina/schemas';
import { describe, expect, it } from 'vitest';
import { RunManager } from './run-manager.js';

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

describe('RunManager', () => {
  it('starts with no runs registered', () => {
    expect(new RunManager().list()).toEqual([]);
  });

  it('registers a run and retrieves it by id', () => {
    const manager = new RunManager();
    const run = makeRun();
    manager.register(run);
    expect(manager.get(run.runId)).toEqual(run);
    expect(manager.list()).toEqual([run]);
  });

  it('returns undefined for an unknown run id', () => {
    expect(new RunManager().get('missing')).toBeUndefined();
  });

  it('merges a patch into the run and bumps updatedAt', async () => {
    const manager = new RunManager();
    const run = makeRun();
    manager.register(run);

    await delay(5);
    const updated = manager.update(run.runId, { phase: 'implementation' });

    expect(updated).toMatchObject({ runId: run.runId, phase: 'implementation' });
    expect(updated.updatedAt).not.toBe(run.updatedAt);
    expect(manager.get(run.runId)).toEqual(updated);
  });

  it('throws when updating an unknown run', () => {
    const manager = new RunManager();
    expect(() => manager.update('missing', { phase: 'done' })).toThrow('Run not found: missing');
  });

  it('tracks an abort controller per run and clears it on demand', () => {
    const manager = new RunManager();
    const controller = new AbortController();
    manager.setAbortController('run-1', controller);
    expect(manager.getAbortController('run-1')).toBe(controller);
    manager.clearAbortController('run-1');
    expect(manager.getAbortController('run-1')).toBeUndefined();
  });

  it('reports active work only while at least one abort controller is registered', () => {
    const manager = new RunManager();
    expect(manager.hasActiveWork()).toBe(false);

    manager.setAbortController('run-1', new AbortController());
    expect(manager.hasActiveWork()).toBe(true);

    manager.clearAbortController('run-1');
    expect(manager.hasActiveWork()).toBe(false);
  });

  it('unregisters a run, removing it from list/get and clearing its abort controller', () => {
    const manager = new RunManager();
    const run = makeRun();
    manager.register(run);
    manager.setAbortController(run.runId, new AbortController());

    manager.unregister(run.runId);

    expect(manager.get(run.runId)).toBeUndefined();
    expect(manager.list()).toEqual([]);
    expect(manager.getAbortController(run.runId)).toBeUndefined();
  });
});
