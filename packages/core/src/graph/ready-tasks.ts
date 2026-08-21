import type { Task } from '@arch/schemas';

export function getReadyTaskIds(tasks: Task[]): string[] {
  const doneIds = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id));
  return tasks
    .filter((task) => task.status === 'pending')
    .filter((task) => task.dependsOn.every((dep) => doneIds.has(dep)))
    .map((task) => task.id);
}
