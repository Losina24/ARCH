import { describe, expect, it } from 'vitest';
import { WorkerReportSchema } from './worker-report.js';

describe('WorkerReportSchema', () => {
  it('parses a valid report', () => {
    const report = WorkerReportSchema.parse({
      taskId: 'TASK-001',
      sessionId: 'session-1',
      filesChanged: ['src/index.js'],
      summary: 'Added and exported add(a, b).',
    });
    expect(report.filesChanged).toEqual(['src/index.js']);
  });

  it('accepts an empty filesChanged list', () => {
    const report = WorkerReportSchema.parse({
      taskId: 'TASK-001',
      sessionId: 'session-1',
      filesChanged: [],
      summary: 'No changes were necessary.',
    });
    expect(report.filesChanged).toEqual([]);
  });

  it('rejects a missing sessionId', () => {
    expect(() =>
      WorkerReportSchema.parse({ taskId: 'TASK-001', filesChanged: [], summary: 'done' }),
    ).toThrow();
  });
});
