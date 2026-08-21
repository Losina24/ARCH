import { describe, expect, it } from 'vitest';
import { AgentMeshConfigSchema, ExecutionConfigSchema, ModelConfigSchema } from './model-config.js';

describe('ModelConfigSchema', () => {
  it('parses without perTaskOverrides', () => {
    const model = ModelConfigSchema.parse({
      architectModel: 'claude-opus-5',
      tlModel: 'claude-sonnet-5',
      workerModel: 'claude-sonnet-5',
    });
    expect(model.perTaskOverrides).toBeUndefined();
  });

  it('parses with perTaskOverrides', () => {
    const model = ModelConfigSchema.parse({
      architectModel: 'claude-opus-5',
      tlModel: 'claude-sonnet-5',
      workerModel: 'claude-sonnet-5',
      perTaskOverrides: { 'TASK-001': 'claude-fable-5' },
    });
    expect(model.perTaskOverrides).toEqual({ 'TASK-001': 'claude-fable-5' });
  });
});

describe('ExecutionConfigSchema', () => {
  it('rejects zero or negative maxConcurrency', () => {
    expect(() => ExecutionConfigSchema.parse({ maxConcurrency: 0, maxRetries: 3 })).toThrow();
    expect(() => ExecutionConfigSchema.parse({ maxConcurrency: -1, maxRetries: 3 })).toThrow();
  });

  it('allows zero maxRetries but not negative', () => {
    expect(ExecutionConfigSchema.parse({ maxConcurrency: 1, maxRetries: 0 }).maxRetries).toBe(0);
    expect(() => ExecutionConfigSchema.parse({ maxConcurrency: 1, maxRetries: -1 })).toThrow();
  });
});

describe('AgentMeshConfigSchema', () => {
  it('parses a full config', () => {
    const config = AgentMeshConfigSchema.parse({
      models: {
        architectModel: 'claude-opus-5',
        tlModel: 'claude-sonnet-5',
        workerModel: 'claude-sonnet-5',
      },
      execution: { maxConcurrency: 4, maxRetries: 3 },
    });
    expect(config.execution.maxConcurrency).toBe(4);
  });
});
