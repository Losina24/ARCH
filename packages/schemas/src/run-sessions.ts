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
  // Last consultation seq used per task, keyed by taskId. A task can be escalated to a
  // consultation more than once across separate daemon runs (a human retries it, it fails again),
  // and each of those is a fresh `runTlTaskCycle` call with its own in-memory counter — this is
  // what lets consultationSeq stay durably increasing across that, instead of every daemon run's
  // first consultation for a task starting back over at 1.
  consultationSeqs: z.record(z.string(), z.number().int().nonnegative()).default({}),
});

export type RunSessions = z.infer<typeof RunSessionsSchema>;
