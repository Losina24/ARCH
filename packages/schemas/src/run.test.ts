import { describe, expect, it } from 'vitest';
import { RunMetaSchema, RunPhaseSchema } from './run.js';

const validRun = {
  runId: 'run-1',
  title: 'Add a function',
  prompt: 'Add a function that sums two numbers',
  cwd: '/tmp/project',
  phase: 'definition',
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
};

describe('RunPhaseSchema', () => {
  it('accepts every known phase', () => {
    for (const phase of ['definition', 'implementation', 'done', 'blocked']) {
      expect(RunPhaseSchema.parse(phase)).toBe(phase);
    }
  });

  it('rejects an unknown phase', () => {
    expect(() => RunPhaseSchema.parse('archived')).toThrow();
  });
});

describe('RunMetaSchema', () => {
  it('parses a valid run', () => {
    expect(RunMetaSchema.parse(validRun)).toEqual(validRun);
  });

  it('rejects an invalid phase', () => {
    expect(() => RunMetaSchema.parse({ ...validRun, phase: 'in_progress' })).toThrow();
  });

  it('rejects a missing required field', () => {
    const { prompt: _prompt, ...withoutPrompt } = validRun;
    expect(() => RunMetaSchema.parse(withoutPrompt)).toThrow();
  });
});
