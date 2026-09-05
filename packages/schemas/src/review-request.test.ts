import { describe, expect, it } from 'vitest';
import { ReviewRequestSchema } from './review-request.js';

const valid = {
  taskId: 'TASK-001',
  seq: 1,
  model: 'sonnet',
  correctionFilePath: '/tmp/run/tasks/TASK-001.corrections.1.md',
  taskMarkdown: '# Task brief',
  correctionMarkdowns: [],
  gitDiff: 'diff --git a/src/index.js b/src/index.js',
  workerSummary: 'Implemented add(a, b) in src/index.js.',
};

describe('ReviewRequestSchema', () => {
  it('parses a valid review request, defaulting dependencyScopes to []', () => {
    expect(ReviewRequestSchema.parse(valid)).toEqual({ ...valid, dependencyScopes: [] });
  });

  it('keeps an explicit dependencyScopes', () => {
    const withScopes = { ...valid, dependencyScopes: ['src/job.ts'] };
    expect(ReviewRequestSchema.parse(withScopes)).toEqual(withScopes);
  });

  it('rejects a non-positive seq', () => {
    expect(() => ReviewRequestSchema.parse({ ...valid, seq: 0 })).toThrow();
  });

  it('rejects a missing required field', () => {
    const { model: _model, ...withoutModel } = valid;
    expect(() => ReviewRequestSchema.parse(withoutModel)).toThrow();
  });
});
