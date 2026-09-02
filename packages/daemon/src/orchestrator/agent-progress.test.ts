import { describe, expect, it } from 'vitest';
import { activityFromProgress } from './agent-progress.js';

describe('activityFromProgress', () => {
  it('adds agent identity while preserving sanitized progress details', () => {
    expect(
      activityFromProgress(
        {
          runId: 'run-1',
          agentId: 'worker-TASK-001',
          role: 'worker',
          taskId: 'TASK-001',
        },
        {
          state: 'using-tool',
          detail: 'Editing file',
          tool: 'Edit',
          file: 'src/auth.ts',
        },
      ),
    ).toEqual({
      type: 'agent:activity',
      runId: 'run-1',
      agentId: 'worker-TASK-001',
      role: 'worker',
      taskId: 'TASK-001',
      state: 'using-tool',
      detail: 'Editing file',
      tool: 'Edit',
      file: 'src/auth.ts',
    });
  });
});
