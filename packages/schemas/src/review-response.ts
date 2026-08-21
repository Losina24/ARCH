import { z } from 'zod';

export const ReviewResponseSchema = z.object({
  taskId: z.string(),
  seq: z.number().int().positive(),
  sessionId: z.string(),
  approved: z.boolean(),
  correctionMarkdown: z.string().optional(),
});

export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;
