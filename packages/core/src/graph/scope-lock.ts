import type { Task } from '@losina/schemas';

function normalize(path: string): string {
  return path.replace(/\/+$/, '');
}

function pathsConflict(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`);
}

export function scopesConflict(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((pa) => b.some((pb) => pathsConflict(pa, pb)));
}

export function selectDispatchableTaskIds(
  readyIds: string[],
  tasks: Task[],
  inFlightTasks: Task[],
  maxConcurrency: number,
  useWorktrees: boolean,
): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const busy = useWorktrees ? [] : [...inFlightTasks];
  const selected: Task[] = [];

  for (const id of readyIds) {
    if (inFlightTasks.length + selected.length >= maxConcurrency) break;
    const task = byId.get(id);
    if (!task) continue;
    if (!useWorktrees && busy.some((other) => scopesConflict(task.scope, other.scope))) continue;
    selected.push(task);
    if (!useWorktrees) busy.push(task);
  }
  return selected.map((task) => task.id);
}
