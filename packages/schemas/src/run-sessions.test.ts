import { describe, expect, it } from 'vitest';
import { RunSessionsSchema } from './run-sessions.js';

describe('RunSessionsSchema', () => {
  it('defaults taskSessions to an empty object when omitted', () => {
    const sessions = RunSessionsSchema.parse({});
    expect(sessions.taskSessions).toEqual({});
    expect(sessions.architectSessionId).toBeUndefined();
  });

  it('parses a fully populated session map', () => {
    const sessions = RunSessionsSchema.parse({
      architectSessionId: 'session-architect',
      taskSessions: { 'TASK-001': 'session-worker-1' },
    });
    expect(sessions.architectSessionId).toBe('session-architect');
    expect(sessions.taskSessions['TASK-001']).toBe('session-worker-1');
  });
});
