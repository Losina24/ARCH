import { describe, expect, it } from 'vitest';
import { processWorkerReport } from './process-worker-report.js';

describe('processWorkerReport', () => {
  it('passes through a passing check as a passing ValidationResult', async () => {
    const result = await processWorkerReport({
      taskId: 'TASK-001',
      worktreePath: process.cwd(),
      checks: [{ name: 'always-pass', command: process.execPath, args: ['-e', 'process.exit(0)'] }],
    });
    expect(result.taskId).toBe('TASK-001');
    expect(result.passed).toBe(true);
  });

  it('passes through a failing check as a failing ValidationResult', async () => {
    const result = await processWorkerReport({
      taskId: 'TASK-001',
      worktreePath: process.cwd(),
      checks: [{ name: 'always-fail', command: process.execPath, args: ['-e', 'process.exit(1)'] }],
    });
    expect(result.passed).toBe(false);
  });

  it('passes with no checks configured for the task', async () => {
    const result = await processWorkerReport({
      taskId: 'TASK-001',
      worktreePath: process.cwd(),
      checks: [],
    });
    expect(result.passed).toBe(true);
    expect(result.checks).toEqual([]);
  });
});
