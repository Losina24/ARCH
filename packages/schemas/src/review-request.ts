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
  /** Flattened `scope` of every task this one depends on — files the diff should not be
   * touching unless the task brief explicitly required it. Defaults to [] so a review-request
   * file written before this field existed still parses. */
  dependencyScopes: z.array(z.string()).default([]),
});

export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
