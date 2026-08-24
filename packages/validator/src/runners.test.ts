import type { CheckDefinition } from '@losina/schemas';
import { describe, expect, it } from 'vitest';
import { runChecks } from './runners.js';

const passingCheck: CheckDefinition = {
  name: 'always-pass',
  command: process.execPath,
  args: ['-e', 'console.log("ok"); process.exit(0)'],
};

const failingCheck: CheckDefinition = {
  name: 'always-fail',
  command: process.execPath,
  args: ['-e', 'console.error("boom"); process.exit(1)'],
};

describe('runChecks', () => {
  it('reports passed=true when every check succeeds', async () => {
    const result = await runChecks('TASK-001', process.cwd(), [passingCheck]);
    expect(result.passed).toBe(true);
    expect(result.checks).toEqual([{ name: 'always-pass', passed: true, output: 'ok' }]);
  });

  it('reports passed=false when any check fails, with output for debugging', async () => {
    const result = await runChecks('TASK-001', process.cwd(), [passingCheck, failingCheck]);

    expect(result.passed).toBe(false);
    expect(result.taskId).toBe('TASK-001');
    const failed = result.checks.find((c) => c.name === 'always-fail');
    expect(failed?.passed).toBe(false);
    expect(failed?.output).toBeTruthy();
  });

  it('returns passed=true for an empty check list', async () => {
    const result = await runChecks('TASK-001', process.cwd(), []);
    expect(result.passed).toBe(true);
    expect(result.checks).toEqual([]);
  });

  it('treats a command that does not exist as a failed check rather than throwing', async () => {
    const result = await runChecks('TASK-001', process.cwd(), [
      { name: 'missing-binary', command: 'this-binary-does-not-exist', args: [] },
    ]);
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.passed).toBe(false);
  });

  it('runs checks concurrently rather than aborting the batch on the first failure', async () => {
    const result = await runChecks('TASK-001', process.cwd(), [failingCheck, passingCheck]);
    expect(result.checks).toHaveLength(2);
    expect(result.checks.find((c) => c.name === 'always-pass')?.passed).toBe(true);
  });
});
