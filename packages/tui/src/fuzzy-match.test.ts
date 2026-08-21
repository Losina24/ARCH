import { describe, expect, it } from 'vitest';
import { filterRuns, fuzzyScore } from './fuzzy-match.js';

describe('fuzzyScore', () => {
  it('returns 0 for an empty query regardless of target', () => {
    expect(fuzzyScore('', 'Add login page')).toBe(0);
  });

  it('matches a case-insensitive subsequence', () => {
    expect(fuzzyScore('lgn', 'Add Login page')).not.toBeNull();
  });

  it('returns null when a character is missing', () => {
    expect(fuzzyScore('zzz', 'Add login page')).toBeNull();
  });

  it('scores a contiguous match higher than a scattered one', () => {
    const contiguous = fuzzyScore('log', 'Add login page');
    const scattered = fuzzyScore('log', 'Lots of garbage');
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous as number).toBeGreaterThan(scattered as number);
  });

  it('rewards a match that starts at a word boundary', () => {
    const boundary = fuzzyScore('page', 'Add login page');
    const midWord = fuzzyScore('ogin', 'Add login page');
    expect(boundary as number).toBeGreaterThan(midWord as number);
  });
});

describe('filterRuns', () => {
  const runs = [
    { title: 'Add login page' },
    { title: 'Fix flaky test' },
    { title: 'Refactor auth middleware' },
  ];

  it('returns every run unchanged for a blank query', () => {
    expect(filterRuns(runs, '')).toEqual(runs);
    expect(filterRuns(runs, '   ')).toEqual(runs);
  });

  it('keeps only runs whose title matches the query', () => {
    const result = filterRuns(runs, 'auth');
    expect(result).toEqual([{ title: 'Refactor auth middleware' }]);
  });

  it('sorts matches by score, best match first', () => {
    const result = filterRuns(runs, 'fl');
    expect(result[0]).toEqual({ title: 'Fix flaky test' });
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterRuns(runs, 'zzzzz')).toEqual([]);
  });
});
