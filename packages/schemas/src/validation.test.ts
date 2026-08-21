import { describe, expect, it } from 'vitest';
import { ValidationResultSchema } from './validation.js';

describe('ValidationResultSchema', () => {
  it('parses a passing result with no checks', () => {
    const result = ValidationResultSchema.parse({ taskId: 'TASK-001', passed: true, checks: [] });
    expect(result.passed).toBe(true);
  });

  it('parses a failing result with check output', () => {
    const result = ValidationResultSchema.parse({
      taskId: 'TASK-001',
      passed: false,
      checks: [{ name: 'syntax-check', passed: false, output: 'SyntaxError: Unexpected token' }],
    });
    expect(result.checks[0]?.passed).toBe(false);
  });

  it('rejects a check missing its output field', () => {
    expect(() =>
      ValidationResultSchema.parse({
        taskId: 'TASK-001',
        passed: false,
        checks: [{ name: 'syntax-check', passed: false }],
      }),
    ).toThrow();
  });
});
