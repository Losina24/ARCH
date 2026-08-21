import { describe, expect, it } from 'vitest';
import { RunPlanSchema } from './run-plan.js';

describe('RunPlanSchema', () => {
  it('parses a plan with an empty task list', () => {
    const plan = RunPlanSchema.parse({ projectMarkdown: '# Brief', tasksIndex: { tasks: [] } });
    expect(plan.tasksIndex.tasks).toEqual([]);
  });

  it('rejects a plan without projectMarkdown', () => {
    expect(() => RunPlanSchema.parse({ tasksIndex: { tasks: [] } })).toThrow();
  });

  it('rejects a plan with a malformed tasksIndex', () => {
    expect(() =>
      RunPlanSchema.parse({ projectMarkdown: '# Brief', tasksIndex: { tasks: 'not-an-array' } }),
    ).toThrow();
  });
});
