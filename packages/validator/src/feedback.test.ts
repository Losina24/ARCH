import type { ValidationResult } from '@arch/schemas';
import { describe, expect, it } from 'vitest';
import { buildCorrectionPrompt } from './feedback.js';

describe('buildCorrectionPrompt', () => {
  it('includes only the failed checks, with their name and output', () => {
    const result: ValidationResult = {
      taskId: 'TASK-001',
      passed: false,
      checks: [
        { name: 'syntax-check', passed: true, output: 'ok' },
        { name: 'lint', passed: false, output: 'unexpected token at line 4' },
      ],
    };

    const prompt = buildCorrectionPrompt(result);

    expect(prompt).toContain('lint');
    expect(prompt).toContain('unexpected token at line 4');
    expect(prompt).not.toContain('syntax-check');
  });

  it('produces an empty details section when every check passed', () => {
    const result: ValidationResult = {
      taskId: 'TASK-001',
      passed: true,
      checks: [{ name: 'syntax-check', passed: true, output: 'ok' }],
    };

    const prompt = buildCorrectionPrompt(result);

    expect(prompt).toContain('The following checks failed');
    expect(prompt).not.toContain('syntax-check');
  });

  it('joins multiple failed checks with a blank line between them', () => {
    const result: ValidationResult = {
      taskId: 'TASK-001',
      passed: false,
      checks: [
        { name: 'check-a', passed: false, output: 'error a' },
        { name: 'check-b', passed: false, output: 'error b' },
      ],
    };

    const prompt = buildCorrectionPrompt(result);
    const indexA = prompt.indexOf('check-a');
    const indexB = prompt.indexOf('check-b');
    expect(indexA).toBeGreaterThanOrEqual(0);
    expect(indexB).toBeGreaterThan(indexA);
    expect(prompt.slice(indexA, indexB)).toContain('\n\n');
  });
});
