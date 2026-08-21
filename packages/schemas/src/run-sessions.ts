import { z } from 'zod';

export const RunSessionsSchema = z.object({
  architectSessionId: z.string().optional(),
  taskSessions: z.record(z.string(), z.string()).default({}),
});

export type RunSessions = z.infer<typeof RunSessionsSchema>;
