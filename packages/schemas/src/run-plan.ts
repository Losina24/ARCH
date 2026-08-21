import { z } from 'zod';
import { TasksIndexSchema } from './task.js';

export const RunPlanSchema = z.object({
  projectMarkdown: z.string(),
  tasksIndex: TasksIndexSchema,
});

export type RunPlan = z.infer<typeof RunPlanSchema>;
