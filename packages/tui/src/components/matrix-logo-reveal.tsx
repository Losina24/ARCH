import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { ARCH_LOGO_CHAR_GRID, type LogoCellKind } from '../logo.js';
import { dimHex, neonGradientColor } from '../neon-gradient.js';

const FRAME_MS = 16;
// Target frame budget for the fill phase — steps-per-frame is derived from grid size
// so the reveal takes roughly the same wall-clock time regardless of terminal size.
const FILL_FRAMES_TARGET = 15;
// How many frames a non-logo character stays lit before fading to fully dim —
// expressed in frames (not raw reveal-steps) so the trail length looks the same
// regardless of how many cells are revealed per frame.
const DECAY_FRAMES = 5;
const HOLD_FRAMES = 3;
const SLIDE_FRAMES = 7;

// Halfwidth katakana (U+FF66-FF9D) render single-column in terminals, unlike
// regular fullwidth katakana — required so falling glyphs line up 1:1 with the
// grid cells they occupy.
const KANA = 'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾙﾚﾛﾜﾝ';

export const DEFAULT_BOOT_ANIMATION_MS = 900;

const DEFAULT_VIEWPORT_COLUMNS = 80;
const DEFAULT_VIEWPORT_ROWS = 24;

// Deterministic per-cell glyph so a revealed character doesn't flicker while its
// opacity fades — same (row, col) always maps to the same kana.
function cellGlyph(row: number, col: number): string {
  return KANA[(row * 131 + col * 17) % KANA.length] ?? KANA[0];
}

type Phase = 'filling' | 'holding' | 'sliding' | 'done';

interface MatrixLogoRevealProps {
  /** 0 skips straight to the fully-collapsed logo and completes on mount (used in tests). */
  durationMs?: number;
  viewportColumns?: number;
  viewportRows?: number;
  /**
   * Extra rows reserved below the logo at rest (e.g. the gap + prompt box that will
   * sit under it once the splash screen takes over). The logo forms centered on the
   * full screen first, then slides up into this shifted resting spot at the end —
   * without this, the logo would form already at its final spot and drift toward
   * the plain screen-center instead of settling into place.
   */
  restingBelowRows?: number;
  onComplete: () => void;
}

export function MatrixLogoReveal({
  durationMs = DEFAULT_BOOT_ANIMATION_MS,
  viewportColumns = DEFAULT_VIEWPORT_COLUMNS,
  viewportRows = DEFAULT_VIEWPORT_ROWS,
  restingBelowRows = 0,
  onComplete,
}: MatrixLogoRevealProps) {
  const logoRowCount = ARCH_LOGO_CHAR_GRID.length;
  const logoColCount = ARCH_LOGO_CHAR_GRID[0]?.length ?? 0;

  const gridRows = Math.max(viewportRows, logoRowCount);
  const gridCols = Math.max(viewportColumns, logoColCount);
  // Where the logo forms while the screen fills — dead center, ignoring restingBelowRows.
  const centerRowOffset = Math.floor((gridRows - logoRowCount) / 2);
  // Where it ends up at rest — shifted up so logo + restingBelowRows centers as a block,
  // matching how the splash layout centers logo + gap + prompt box together.
  const restRowOffset = Math.max(0, Math.floor((gridRows - logoRowCount - restingBelowRows) / 2));
  const colOffset = Math.floor((gridCols - logoColCount) / 2);

  // Column-major reveal order: column 0 top-to-bottom, then column 1, etc.
  const totalCells = gridRows * gridCols;
  const stepsPerFrame = Math.max(1, Math.ceil(totalCells / FILL_FRAMES_TARGET));
  const decaySteps = stepsPerFrame * DECAY_FRAMES;
  const fillSteps = totalCells + decaySteps;
  const fillFrames = Math.max(1, Math.ceil(fillSteps / stepsPerFrame));
  const totalFrames = fillFrames + HOLD_FRAMES + SLIDE_FRAMES;

  const [frame, setFrame] = useState(durationMs > 0 ? 0 : totalFrames);

  // Frame budget is fixed for the lifetime of this mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: totalFrames is fixed for the lifetime of this mount.
  useEffect(() => {
    if (durationMs <= 0) return;
    const interval = setInterval(() => {
      setFrame((current) => {
        if (current >= totalFrames) {
          clearInterval(interval);
          return current;
        }
        return current + 1;
      });
    }, FRAME_MS);
    return () => clearInterval(interval);
  }, []);

  // Only the frame reaching its terminal value should fire completion.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onComplete/totalFrames intentionally excluded, only frame changes should retrigger this.
  useEffect(() => {
    if (frame >= totalFrames) onComplete();
  }, [frame]);

  let phase: Phase;
  let step = fillSteps;
  let rowOffset = centerRowOffset;

  if (frame < fillFrames) {
    phase = 'filling';
    step = Math.min(fillSteps, (frame + 1) * stepsPerFrame);
  } else if (frame < fillFrames + HOLD_FRAMES) {
    phase = 'holding';
  } else if (frame < totalFrames) {
    phase = 'sliding';
    const slideFrame = frame - (fillFrames + HOLD_FRAMES) + 1;
    const t = Math.min(1, slideFrame / SLIDE_FRAMES);
    rowOffset = Math.round(centerRowOffset + (restRowOffset - centerRowOffset) * t);
  } else {
    phase = 'done';
    rowOffset = restRowOffset;
  }

  function isLogoCell(row: number, col: number): boolean {
    const localRow = row - rowOffset;
    const localCol = col - colOffset;
    if (localRow < 0 || localRow >= logoRowCount || localCol < 0 || localCol >= logoColCount) {
      return false;
    }
    const kind: LogoCellKind = ARCH_LOGO_CHAR_GRID[localRow][localCol];
    return kind !== 'off';
  }

  // During the fill phase: characters are revealed column by column, top to bottom.
  // A freshly revealed character starts fully lit and fades out over decaySteps —
  // unless it sits on the logo silhouette (formed dead-center), which stays fully lit.
  function fillOpacityAt(row: number, col: number): number {
    const order = col * gridRows + row;
    if (order >= step) return 0;
    if (isLogoCell(row, col)) return 1;
    const age = step - 1 - order;
    return Math.max(0, 1 - age / decaySteps);
  }

  // Once the grid has fully filled and decayed, only the logo silhouette remains lit —
  // sliding from screen-center to its resting spot as rowOffset animates.
  function settledOpacityAt(row: number, col: number): number {
    return isLogoCell(row, col) ? 1 : 0;
  }

  function renderCell(row: number, col: number, opacity: number) {
    if (opacity <= 0) {
      return <Text key={col}> </Text>;
    }
    const gradient = neonGradientColor(gridCols <= 1 ? 0 : col / (gridCols - 1));
    return (
      <Text key={col} color={dimHex(gradient, opacity)}>
        {cellGlyph(row, col)}
      </Text>
    );
  }

  const rows = [];
  for (let row = 0; row < gridRows; row++) {
    const cells = [];
    for (let col = 0; col < gridCols; col++) {
      const opacity = phase === 'filling' ? fillOpacityAt(row, col) : settledOpacityAt(row, col);
      cells.push(renderCell(row, col, opacity));
    }
    rows.push(<Box key={row}>{cells}</Box>);
  }

  return <Box flexDirection="column">{rows}</Box>;
}
