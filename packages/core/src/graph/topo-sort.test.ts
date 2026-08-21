import type { Task } from '@arch/schemas';
import { describe, expect, it } from 'vitest';
import { CyclicDependencyError, UnknownDependencyError, topologicalWaves } from './topo-sort.js';

function makeTask(id: string, dependsOn: string[] = []): Task {
  return {
    id,
    title: id,
    status: 'pending',
    dependsOn,
    file: `tasks/${id}.md`,
    correctionFiles: [],
    retries: 0,
    checks: [],
  };
}

describe('topologicalWaves', () => {
  it('puts independent tasks in a single wave', () => {
    const waves = topologicalWaves([makeTask('A'), makeTask('B'), makeTask('C')]);
    expect(waves).toHaveLength(1);
    expect(waves[0]?.map((t) => t.id).sort()).toEqual(['A', 'B', 'C']);
  });

  it('separates a linear chain into one wave per task', () => {
    const waves = topologicalWaves([makeTask('A'), makeTask('B', ['A']), makeTask('C', ['B'])]);
    expect(waves.map((wave) => wave.map((t) => t.id))).toEqual([['A'], ['B'], ['C']]);
  });

  it('groups a diamond dependency into three waves', () => {
    const waves = topologicalWaves([
      makeTask('A'),
      makeTask('B', ['A']),
      makeTask('C', ['A']),
      makeTask('D', ['B', 'C']),
    ]);
    expect(waves).toHaveLength(3);
    expect(waves[0]?.map((t) => t.id)).toEqual(['A']);
    expect(waves[1]?.map((t) => t.id).sort()).toEqual(['B', 'C']);
    expect(waves[2]?.map((t) => t.id)).toEqual(['D']);
  });

  it('throws UnknownDependencyError when a task depends on a nonexistent task', () => {
    expect(() => topologicalWaves([makeTask('A', ['GHOST'])])).toThrow(UnknownDependencyError);
  });

  it('throws CyclicDependencyError for a direct cycle', () => {
    expect(() => topologicalWaves([makeTask('A', ['B']), makeTask('B', ['A'])])).toThrow(
      CyclicDependencyError,
    );
  });

  it('throws CyclicDependencyError for a self-dependency', () => {
    expect(() => topologicalWaves([makeTask('A', ['A'])])).toThrow(CyclicDependencyError);
  });

  it('returns an empty list of waves for an empty task list', () => {
    expect(topologicalWaves([])).toEqual([]);
  });
});
