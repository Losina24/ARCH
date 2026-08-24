import type { AgentMeshConfig } from '@losina/schemas';

export const DEFAULT_CONFIG: AgentMeshConfig = {
  models: {
    architectModel: 'claude-opus-5',
    tlModel: 'claude-sonnet-5',
    workerModel: 'claude-sonnet-5',
  },
  execution: {
    maxConcurrency: 4,
    maxRetries: 3,
    useWorktrees: true,
  },
};
