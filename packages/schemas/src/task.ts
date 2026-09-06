import { z } from 'zod';
import { CheckDefinitionSchema } from './check-definition.js';

export const TaskStatusSchema = z.enum([
  'pending',
  'ready',
  'blocked',
  'in_progress',
  'in_review',
  'needs_correction',
  'done',
  'failed',
  'awaiting_human',
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  dependsOn: z.array(z.string()),
  file: z.string(),
  correctionFiles: z.array(z.string()),
  retries: z.number().int().nonnegative(),
  checks: z.array(CheckDefinitionSchema).default([]),
  scope: z.array(z.string()).default([]),
  failureReason: z.string().optional(),
  /**
   * Absolute path to the git repository this task's work happens in. Optional so a run whose
   * `cwd` is itself a single repo (the common case) needs no per-task value; falls back to
   * `run.cwd` wherever it's read. Only required when a run spans multiple sibling repositories.
   */
  repoRoot: z.string().optional(),
});

export type Task = z.infer<typeof TaskSchema>;

export const TasksIndexSchema = z.object({
  tasks: z.array(TaskSchema),
});

export type TasksIndex = z.infer<typeof TasksIndexSchema>;

/**
 * What the Architect actually decides when it adds a task to an already-approved plan (e.g. from
 * a chat turn that calls for real work) — everything about a task except its runtime state, which
 * is always the same for a brand-new task (see `mergeNewTasks` in @losina/core).
 */
export const NewTaskSpecSchema = TaskSchema.omit({
  status: true,
  correctionFiles: true,
  retries: true,
  failureReason: true,
}).extend({
  dependsOn: z.array(z.string()).default([]),
});

export type NewTaskSpec = z.infer<typeof NewTaskSpecSchema>;

export const ChatNewTasksSchema = z.object({
  tasks: z.array(NewTaskSpecSchema),
});

export type ChatNewTasks = z.infer<typeof ChatNewTasksSchema>;
