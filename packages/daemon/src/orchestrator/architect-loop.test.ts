import { describe, expect, it } from 'vitest';
import { summarizeActivityFailure } from './architect-loop.js';

describe('summarizeActivityFailure', () => {
  it("returns an Error's own message unchanged when it's short", () => {
    expect(summarizeActivityFailure(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error thrown value', () => {
    expect(summarizeActivityFailure('a plain string')).toBe('a plain string');
    expect(summarizeActivityFailure({ code: 'ENAMETOOLONG' })).toBe('[object Object]');
  });

  it('returns a message well under the bound unchanged, without adding a truncation marker', () => {
    const message =
      'Claude CLI exited unexpectedly (no exit code — the process may not have started).';
    expect(summarizeActivityFailure(new Error(message))).toBe(message);
  });

  it('truncates a message longer than the bound, appending a marker', () => {
    const huge = 'x'.repeat(2000);
    const result = summarizeActivityFailure(new Error(huge));
    expect(result.length).toBe(501); // 500 chars + the truncation marker
    expect(result.endsWith('…')).toBe(true);
    expect(result.startsWith('x'.repeat(500))).toBe(true);
  });

  it('leaves a message exactly at the bound unchanged', () => {
    const exact = 'x'.repeat(500);
    expect(summarizeActivityFailure(new Error(exact))).toBe(exact);
  });
});
