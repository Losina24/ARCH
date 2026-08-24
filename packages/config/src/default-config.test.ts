import { AgentMeshConfigSchema } from '@losina/schemas';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './default-config.js';

describe('DEFAULT_CONFIG', () => {
  it('is itself a valid AgentMeshConfig', () => {
    expect(() => AgentMeshConfigSchema.parse(DEFAULT_CONFIG)).not.toThrow();
  });

  it('ships sane defaults', () => {
    expect(DEFAULT_CONFIG.execution.maxConcurrency).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.execution.maxRetries).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CONFIG.execution.useWorktrees).toBe(true);
  });
});
