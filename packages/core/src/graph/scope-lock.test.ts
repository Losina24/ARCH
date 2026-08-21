import type { Task } from '@arch/schemas';
import { describe, expect, it } from 'vitest';
import { scopesConflict, selectDispatchableTaskIds } from './scope-lock.js';

function makeTask(id: string, scope: string[]): Task {
  return {
    id,
    title: id,
    status: 'pending',
    dependsOn: [],
    file: `tasks/${id}.md`,
    correctionFiles: [],
    retries: 0,
    checks: [],
    scope,
  };
}

describe('scopesConflict', () => {
  it('conflicts with everything when either scope is empty', () => {
    expect(scopesConflict([], ['apps/a/'])).toBe(true);
    expect(scopesConflict(['apps/a/'], [])).toBe(true);
    expect(scopesConflict([], [])).toBe(true);
  });

  it('does not conflict when paths are disjoint', () => {
    expect(scopesConflict(['apps/a/'], ['apps/b/'])).toBe(false);
  });

  it('conflicts when one path is nested inside the other', () => {
    expect(scopesConflict(['apps/a/'], ['apps/a/feature/'])).toBe(true);
    expect(scopesConflict(['apps/a/feature/'], ['apps/a/'])).toBe(true);
  });

  it('conflicts on an exact match', () => {
    expect(scopesConflict(['apps/a/'], ['apps/a/'])).toBe(true);
  });
});

describe('selectDispatchableTaskIds', () => {
  it('ignores scope entirely when useWorktrees is true', () => {
    const tasks = [makeTask('T1', ['apps/a/']), makeTask('T2', ['apps/a/'])];
    const result = selectDispatchableTaskIds(['T1', 'T2'], tasks, [], 4, true);
    expect(result).toEqual(['T1', 'T2']);
  });

  it('serializes tasks with conflicting scopes when useWorktrees is false', () => {
    const tasks = [makeTask('T1', ['apps/a/']), makeTask('T2', ['apps/a/'])];
    const result = selectDispatchableTaskIds(['T1', 'T2'], tasks, [], 4, false);
    expect(result).toEqual(['T1']);
  });

  it('dispatches tasks with disjoint scopes in parallel when useWorktrees is false', () => {
    const tasks = [makeTask('T1', ['apps/a/']), makeTask('T2', ['apps/b/'])];
    const result = selectDispatchableTaskIds(['T1', 'T2'], tasks, [], 4, false);
    expect(result).toEqual(['T1', 'T2']);
  });

  it('does not dispatch a new task whose scope conflicts with one already in flight', () => {
    const inFlight = makeTask('T0', ['apps/a/']);
    const tasks = [makeTask('T1', ['apps/a/'])];
    const result = selectDispatchableTaskIds(['T1'], tasks, [inFlight], 4, false);
    expect(result).toEqual([]);
  });

  it('respects maxConcurrency', () => {
    const tasks = [makeTask('T1', ['apps/a/']), makeTask('T2', ['apps/b/'])];
    const result = selectDispatchableTaskIds(['T1', 'T2'], tasks, [], 1, false);
    expect(result).toEqual(['T1']);
  });
});
