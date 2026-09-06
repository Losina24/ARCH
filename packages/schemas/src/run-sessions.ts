import { z } from 'zod';

export const RunSessionsSchema = z.object({
  architectSessionId: z.string().optional(),
  // Deliberately separate from architectSessionId: review/consultation calls never resume a
  // session (each one is self-contained by design), but chat is a genuinely ongoing conversation
  // — this is the one thread that IS meant to remember every prior turn, the same way a Claude
  // Code session does, resumed on every `run.chat` call regardless of which run phase it's in.
  chatSessionId: z.string().optional(),
  taskSessions: z.record(z.string(), z.string()).default({}),
  grillingSeq: z.number().int().nonnegative().default(0),
});

export type RunSessions = z.infer<typeof RunSessionsSchema>;
