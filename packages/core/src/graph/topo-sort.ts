import type { Task } from '@arch/schemas';

export class CyclicDependencyError extends Error {
  constructor(remainingIds: string[]) {
    super(`Cyclic dependency detected among tasks: ${remainingIds.join(', ')}`);
  }
}

export class UnknownDependencyError extends Error {
  constructor(taskId: string, missingId: string) {
    super(`Task ${taskId} depends on unknown task ${missingId}`);
  }
}

export function topologicalWaves(tasks: Task[]): Task[][] {
  const knownIds = new Set(tasks.map((t) => t.id));
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!knownIds.has(dep)) {
        throw new UnknownDependencyError(task.id, dep);
      }
    }
  }

  const resolved = new Set<string>();
  const waves: Task[][] = [];

  while (resolved.size < tasks.length) {
    const wave = tasks.filter(
      (t) => !resolved.has(t.id) && t.dependsOn.every((dep) => resolved.has(dep)),
    );

    if (wave.length === 0) {
      const remainingIds = tasks.filter((t) => !resolved.has(t.id)).map((t) => t.id);
      throw new CyclicDependencyError(remainingIds);
    }

    for (const task of wave) {
      resolved.add(task.id);
    }
    waves.push(wave);
  }

  return waves;
}
