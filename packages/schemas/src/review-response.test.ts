import { describe, expect, it } from 'vitest';
import { ReviewResponseSchema } from './review-response.js';

describe('ReviewResponseSchema', () => {
  it('parses an approved response without a correction markdown', () => {
    const response = { taskId: 'TASK-001', seq: 1, sessionId: 'session-1', approved: true };
    expect(ReviewResponseSchema.parse(response)).toEqual(response);
  });

  it('parses a rejected response carrying the correction markdown', () => {
    const response = {
      taskId: 'TASK-001',
      seq: 1,
      sessionId: 'session-1',
      approved: false,
      correctionMarkdown: 'Handle the negative-number case too.',
    };
    expect(ReviewResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects a non-positive seq', () => {
    expect(() =>
      ReviewResponseSchema.parse({ taskId: 'TASK-001', seq: 0, sessionId: 's', approved: true }),
    ).toThrow();
  });
});
