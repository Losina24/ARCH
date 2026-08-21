import { z } from 'zod';

export const ValidationResultSchema = z.object({
  taskId: z.string(),
  passed: z.boolean(),
  checks: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      output: z.string(),
    }),
  ),
});

export type ValidationResult = z.infer<typeof ValidationResultSchema>;
