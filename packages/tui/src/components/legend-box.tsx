import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

interface LegendBoxProps {
  label: string;
  width: number;
  /** Total height including the label line above the bordered box, if the box must fill an exact space. */
  height?: number;
  borderColor?: string;
  children: ReactNode;
}

// Ink's borderStyle has no way to embed a label in the border itself, so the
// top edge is hand-drawn with the label cut into it, then a borderless-top
// Box supplies the matching left/right/bottom edges underneath.
function topLine(label: string, width: number): string {
  const innerWidth = Math.max(0, width - 2);
  const legend = ` ${label} `;
  const leadingDash = 1;
  const trailingDashes = Math.max(0, innerWidth - leadingDash - legend.length);
  return `┌${'─'.repeat(leadingDash)}${legend}${'─'.repeat(trailingDashes)}┐`;
}

export function LegendBox({
  label,
  width,
  height,
  borderColor = 'gray',
  children,
}: LegendBoxProps) {
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text color={borderColor}>{topLine(label, width)}</Text>
      <Box
        borderStyle="single"
        borderTop={false}
        borderColor={borderColor}
        flexDirection="column"
        paddingX={1}
        width={width}
        height={height ? height - 1 : undefined}
      >
        {children}
      </Box>
    </Box>
  );
}
