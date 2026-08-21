/**
 * Hand-rolled 7-row block font for ARCH's splash wordmark, with thick
 * 3-wide strokes, a tapered apex on the A and a diagonal leg on the R for a
 * denser, more elaborate cyberpunk silhouette. Each cell is classified as
 * the solid stroke ('on'), a soft glow bleeding just outside the stroke
 * ('halo'), or clear background ('off') — rendered as a bright neon core
 * ringed by a dim halo, like a lit neon-tube sign.
 */
const GLYPHS: Record<string, string[]> = {
  A: [
    '...####...',
    '..######..',
    '.###..###.',
    '##########',
    '###....###',
    '###....###',
    '###....###',
  ],
  R: [
    '##########.',
    '###.....###',
    '###.....###',
    '##########.',
    '###...###..',
    '###....###.',
    '###.....###',
  ],
  C: [
    '..#######.',
    '.###...###',
    '###.......',
    '###.......',
    '###.......',
    '.###...###',
    '..#######.',
  ],
  H: [
    '###.....###',
    '###.....###',
    '###.....###',
    '###########',
    '###.....###',
    '###.....###',
    '###.....###',
  ],
};

export type LogoCellKind = 'on' | 'halo' | 'off';

const NEIGHBOR_DELTAS: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function cellKind(glyph: string[], row: number, col: number): LogoCellKind {
  if (glyph[row][col] === '#') return 'on';

  const hasLitNeighbor = NEIGHBOR_DELTAS.some(([deltaRow, deltaCol]) => {
    const r = row + deltaRow;
    const c = col + deltaCol;
    if (r < 0 || r >= glyph.length) return false;
    const line = glyph[r];
    return c >= 0 && c < line.length && line[c] === '#';
  });

  return hasLitNeighbor ? 'halo' : 'off';
}

export function buildLetterCells(letter: string): LogoCellKind[][] {
  const glyph = GLYPHS[letter.toUpperCase()];
  if (!glyph) return [];

  return glyph.map((rowPattern, row) =>
    rowPattern.split('').map((_, col) => cellKind(glyph, row, col)),
  );
}

export function buildLogoLetters(word: string): LogoCellKind[][][] {
  return word
    .toUpperCase()
    .split('')
    .map(buildLetterCells)
    .filter((grid) => grid.length > 0);
}

export const ARCH_LOGO_LETTERS = buildLogoLetters('ARCH');

// Matches the Logo component: each cell renders as a 2-char glyph ('██'/'░░'/'  '),
// with a 1-column gap between letters.
export const LOGO_CELL_GLYPH_WIDTH = 2;
export const LOGO_LETTER_GAP = 1;

function logoRenderedWidth(letters: LogoCellKind[][][]): number {
  const letterWidths = letters.map((letter) => letter[0]?.length ?? 0);
  const totalCells = letterWidths.reduce((sum, width) => sum + width, 0);
  return totalCells * LOGO_CELL_GLYPH_WIDTH + Math.max(0, letters.length - 1) * LOGO_LETTER_GAP;
}

// The full rendered width (in terminal columns) of the ARCH wordmark — used to size
// the prompt box so it visually matches the logo above it.
export const ARCH_LOGO_WIDTH = logoRenderedWidth(ARCH_LOGO_LETTERS);

/**
 * Expands ARCH_LOGO_LETTERS into a per-character grid (one entry per terminal
 * column, rather than one per 2-char cell) — each cell duplicated across its
 * 2-column width, with 'off' gap columns inserted between letters. Used to test
 * "is this single terminal column part of the logo silhouette?" when overlaying
 * the wordmark onto a full-screen grid, e.g. for the boot splash reveal.
 */
function buildLogoCharGrid(letters: LogoCellKind[][][]): LogoCellKind[][] {
  const rowCount = letters[0]?.length ?? 0;
  const grid: LogoCellKind[][] = Array.from({ length: rowCount }, () => []);

  for (const [letterIndex, letter] of letters.entries()) {
    for (const [row, rowCells] of letter.entries()) {
      for (const kind of rowCells) {
        grid[row].push(kind, kind);
      }
    }
    if (letterIndex < letters.length - 1) {
      for (let row = 0; row < rowCount; row++) {
        for (let gap = 0; gap < LOGO_LETTER_GAP; gap++) grid[row].push('off');
      }
    }
  }

  return grid;
}

export const ARCH_LOGO_CHAR_GRID = buildLogoCharGrid(ARCH_LOGO_LETTERS);
