import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunSessions } from '@arch/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRunSessions, saveRunSessions } from './session-store.js';

describe('loadRunSessions / saveRunSessions', () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'arch-session-store-test-'));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it('returns an empty session map when no file exists yet', async () => {
    expect(await loadRunSessions(runDir)).toEqual({ taskSessions: {} });
  });

  it('round-trips a populated session map', async () => {
    const sessions: RunSessions = {
      architectSessionId: 'session-architect',
      taskSessions: { 'TASK-001': 'session-worker-1' },
    };
    await saveRunSessions(runDir, sessions);
    expect(await loadRunSessions(runDir)).toEqual(sessions);
  });

  it('supports the read-right-before-write merge pattern across two independent tasks', async () => {
    await saveRunSessions(runDir, { taskSessions: { 'TASK-001': 'session-1' } });

    const current = await loadRunSessions(runDir);
    await saveRunSessions(runDir, {
      ...current,
      taskSessions: { ...current.taskSessions, 'TASK-002': 'session-2' },
    });

    expect(await loadRunSessions(runDir)).toEqual({
      taskSessions: { 'TASK-001': 'session-1', 'TASK-002': 'session-2' },
    });
  });
});
