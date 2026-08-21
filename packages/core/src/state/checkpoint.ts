import { readFile, writeFile } from 'node:fs/promises';
import { type TasksIndex, TasksIndexSchema } from '@arch/schemas';
import { parse, stringify } from 'yaml';

export async function loadTasksIndex(path: string): Promise<TasksIndex> {
  const raw = await readFile(path, 'utf-8');
  return TasksIndexSchema.parse(parse(raw));
}

export async function saveTasksIndex(path: string, index: TasksIndex): Promise<void> {
  const validated = TasksIndexSchema.parse(index);
  await writeFile(path, stringify(validated), 'utf-8');
}
