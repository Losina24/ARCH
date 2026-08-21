import { describe, expect, it } from 'vitest';
import { RunAbortedError } from './run-aborted-error.js';

describe('RunAbortedError', () => {
  it('is an Error carrying the run id in its message', () => {
    const error = new RunAbortedError('run-1');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Run aborted: run-1');
  });
});
