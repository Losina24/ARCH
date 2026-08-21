import type { Task } from '@arch/schemas';

export function cascadeBlockDependentTasks(tasks: Task[]): string[] {
  const stuckIds = new Set(
    tasks
      .filter(
        (task) =>
          task.status === 'failed' || task.status === 'blocked' || task.status === 'awaiting_human',
      )
      .map((task) => task.id),
  );
  const newlyBlocked: string[] = [];

  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (task.status === 'pending' && task.dependsOn.some((dep) => stuckIds.has(dep))) {
        task.status = 'blocked';
        stuckIds.add(task.id);
        newlyBlocked.push(task.id);
        changed = true;
      }
    }
  }

  return newlyBlocked;
}
