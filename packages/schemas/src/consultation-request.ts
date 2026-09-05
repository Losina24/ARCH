import { z } from 'zod';

/**
 * Which deterministic rule gave up and escalated a task to a human — mirrors the six sites in
 * `runTlTaskCycle` (tl-loop.ts) that decide a task needs a human: scope violation, automated
 * checks, an infra/network blip mistaken for neither, an Architect review rejection, a crash that
 * looks like it needs a human's approval, or any other crash.
 */
export const ConsultationFailureKindSchema = z.enum([
  'checks',
  'scope',
  'infra',
  'review',
  'crash',
  'needs-human',
]);

export type ConsultationFailureKind = z.infer<typeof ConsultationFailureKindSchema>;

/**
 * Unlike a review request, this is request-only — the Architect's reply (a short question and
 * recommendation) travels inline on the `consultation:completed` event instead of a response
 * file, since it's small and there's nothing further to look up on disk once it's produced.
 */
export const ConsultationRequestSchema = z.object({
  taskId: z.string(),
  seq: z.number().int().positive(),
  model: z.string(),
  consultationFilePath: z.string(),
  taskMarkdown: z.string(),
  correctionMarkdowns: z.array(z.string()),
  gitDiff: z.string(),
  workerSummary: z.string(),
  failureReason: z.string(),
  failureKind: ConsultationFailureKindSchema,
  retriesSpent: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
});

export type ConsultationRequest = z.infer<typeof ConsultationRequestSchema>;
