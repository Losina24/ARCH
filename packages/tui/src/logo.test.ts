import { describe, expect, it } from 'vitest';
import { ARCH_LOGO_LETTERS, buildLetterCells, buildLogoLetters } from './logo.js';

describe('buildLetterCells', () => {
  it('classifies each cell of a known letter as on, halo, or off', () => {
    const grid = buildLetterCells('A');
    expect(grid).toHaveLength(7);
    for (const row of grid) {
      expect(row.length).toBeGreaterThan(0);
      for (const kind of row) expect(['on', 'halo', 'off']).toContain(kind);
    }
  });

  it('marks the stroke as on and its immediate surroundings as halo', () => {
    const grid = buildLetterCells('A');
    expect(grid[0][3]).toBe('on');
    expect(grid[0][2]).toBe('halo');
    expect(grid[5][4]).toBe('off');
  });

  it('returns an empty array for an unknown letter', () => {
    expect(buildLetterCells('?')).toEqual([]);
  });
});

describe('buildLogoLetters', () => {
  it('returns one grid per known letter', () => {
    const letters = buildLogoLetters('ARCH');
    expect(letters).toHaveLength(4);
    for (const grid of letters) expect(grid).toHaveLength(7);
  });

  it('skips characters without a defined glyph', () => {
    expect(buildLogoLetters('A?C')).toHaveLength(2);
  });

  it('returns an empty array when no character has a known glyph', () => {
    expect(buildLogoLetters('123')).toEqual([]);
  });

  it('exports the precomputed ARCH wordmark', () => {
    expect(ARCH_LOGO_LETTERS).toHaveLength(4);
    expect(ARCH_LOGO_LETTERS.every((grid) => grid.length === 7)).toBe(true);
  });
});
