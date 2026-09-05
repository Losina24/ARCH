import { z } from 'zod';

export const ModelConfigSchema = z.object({
  architectModel: z.string(),
  workerModel: z.string(),
  perTaskOverrides: z.record(z.string(), z.string()).optional(),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ExecutionConfigSchema = z.object({
  maxConcurrency: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
  useWorktrees: z.boolean().default(true),
});

export type ExecutionConfig = z.infer<typeof ExecutionConfigSchema>;

export const AgentMeshConfigSchema = z.object({
  models: ModelConfigSchema,
  execution: ExecutionConfigSchema,
});

export type AgentMeshConfig = z.infer<typeof AgentMeshConfigSchema>;
