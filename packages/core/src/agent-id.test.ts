import { describe, expect, it } from 'vitest';
import { workerAgentId } from './agent-id.js';

describe('workerAgentId', () => {
  it('prefixes the task id with worker-', () => {
    expect(workerAgentId('TASK-001')).toBe('worker-TASK-001');
  });
});
