import { z } from 'zod';

export const RunSessionsSchema = z.object({
  architectSessionId: z.string().optional(),
  taskSessions: z.record(z.string(), z.string()).default({}),
  grillingSeq: z.number().int().nonnegative().default(0),
});

export type RunSessions = z.infer<typeof RunSessionsSchema>;
