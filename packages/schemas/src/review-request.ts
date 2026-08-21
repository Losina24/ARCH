import { z } from 'zod';

export const ReviewRequestSchema = z.object({
  taskId: z.string(),
  seq: z.number().int().positive(),
  model: z.string(),
  correctionFilePath: z.string(),
  taskMarkdown: z.string(),
  correctionMarkdowns: z.array(z.string()),
  gitDiff: z.string(),
  workerSummary: z.string(),
});

export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
