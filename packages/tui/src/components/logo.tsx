import { Box, Text } from 'ink';
import { ARCH_LOGO_LETTERS, LOGO_LETTER_GAP, type LogoCellKind } from '../logo.js';
import { dimHex, neonGradientColor } from '../neon-gradient.js';

const HALO_BRIGHTNESS = 0.35;
const DIM_FACTOR = 0.35;

function cellGlyph(kind: LogoCellKind): string {
  if (kind === 'on') return '██';
  if (kind === 'halo') return '░░';
  return '  ';
}

interface LogoProps {
  dim?: boolean;
}

export function Logo({ dim = false }: LogoProps = {}) {
  const rowCount = ARCH_LOGO_LETTERS[0]?.length ?? 0;
  const letterWidths = ARCH_LOGO_LETTERS.map((letter) => letter[0]?.length ?? 0);
  const totalWidth = letterWidths.reduce((sum, letterWidth) => sum + letterWidth, 0);

  let cursor = 0;
  const letterOffsets = letterWidths.map((letterWidth) => {
    const offset = cursor;
    cursor += letterWidth;
    return offset;
  });

  return (
    <Box flexDirection="column" alignItems="center">
      {Array.from({ length: rowCount }, (_, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ARCH_LOGO_LETTERS is a fixed-shape constant, rows never reorder
        <Box key={row}>
          {ARCH_LOGO_LETTERS.map((letter, letterIndex) => (
            <Box
              // biome-ignore lint/suspicious/noArrayIndexKey: same fixed-shape constant, letters never reorder
              key={letterIndex}
              marginRight={letterIndex < ARCH_LOGO_LETTERS.length - 1 ? LOGO_LETTER_GAP : 0}
            >
              {letter[row].map((kind, col) => {
                const globalCol = letterOffsets[letterIndex] + col;
                const gradient = neonGradientColor(
                  totalWidth <= 1 ? 0 : globalCol / (totalWidth - 1),
                );
                const bright = dim ? dimHex(gradient, DIM_FACTOR) : gradient;
                const color =
                  kind === 'on'
                    ? bright
                    : kind === 'halo'
                      ? dimHex(bright, HALO_BRIGHTNESS)
                      : undefined;

                return (
                  <Text
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-shape constant, columns never reorder
                    key={col}
                    bold={kind === 'on'}
                    color={color}
                  >
                    {cellGlyph(kind)}
                  </Text>
                );
              })}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
