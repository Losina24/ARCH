import { z } from 'zod';

export const RunPhaseSchema = z.enum(['definition', 'implementation', 'done', 'blocked']);

export type RunPhase = z.infer<typeof RunPhaseSchema>;

export const RunMetaSchema = z.object({
  runId: z.string(),
  title: z.string(),
  prompt: z.string(),
  cwd: z.string(),
  phase: RunPhaseSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RunMeta = z.infer<typeof RunMetaSchema>;
