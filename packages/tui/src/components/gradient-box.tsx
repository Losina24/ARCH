import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { dimHex, neonGradientColor } from '../neon-gradient.js';

interface GradientBoxProps {
  width: number;
  paddingX?: number;
  dim?: boolean;
  children: ReactNode;
}

const DIM_FACTOR = 0.35;

function borderColorAt(col: number, width: number, dim: boolean): string {
  const color = neonGradientColor(width <= 1 ? 0 : col / (width - 1));
  return dim ? dimHex(color, DIM_FACTOR) : color;
}

/**
 * Top/bottom edges are hand-drawn: Ink's native `borderStyle`/`borderColor`
 * only accepts one flat color per side, so each character is rendered
 * individually to sweep the same cyberpunk gradient as the Logo, left to
 * right. Left/right edges use Ink's native border instead — it repeats the
 * side glyph on every content row automatically, which a hand-drawn single
 * `<Text>` sibling cannot do once `children` spans more than one row.
 */
export function GradientBox({ width, paddingX = 1, dim = false, children }: GradientBoxProps) {
  const innerWidth = Math.max(0, width - 2);

  return (
    <Box flexDirection="column" width={width}>
      <Box>
        <Text color={borderColorAt(0, width, dim)}>╭</Text>
        {Array.from({ length: innerWidth }, (_, col) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length border row, columns never reorder
          <Text key={col} color={borderColorAt(col + 1, width, dim)}>
            ─
          </Text>
        ))}
        <Text color={borderColorAt(width - 1, width, dim)}>╮</Text>
      </Box>
      <Box
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderLeftColor={borderColorAt(0, width, dim)}
        borderRightColor={borderColorAt(width - 1, width, dim)}
        flexDirection="column"
        paddingX={paddingX}
        width={width}
      >
        {children}
      </Box>
      <Box>
        <Text color={borderColorAt(0, width, dim)}>╰</Text>
        {Array.from({ length: innerWidth }, (_, col) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length border row, columns never reorder
          <Text key={col} color={borderColorAt(col + 1, width, dim)}>
            ─
          </Text>
        ))}
        <Text color={borderColorAt(width - 1, width, dim)}>╯</Text>
      </Box>
    </Box>
  );
}
