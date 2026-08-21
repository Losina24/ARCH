import { z } from 'zod';

export const WorkerReportSchema = z.object({
  taskId: z.string(),
  sessionId: z.string(),
  filesChanged: z.array(z.string()),
  summary: z.string(),
});

export type WorkerReport = z.infer<typeof WorkerReportSchema>;
