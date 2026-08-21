import { Box, Text } from 'ink';
import { ACCENT, MODAL_BG } from '../theme.js';

interface ModalProps {
  title: string;
  hint: string;
  bodyLines: string[];
  width: number;
  height: number;
  columns: number;
  rows: number;
}

const SIDE_PADDING = 2;

/**
 * Centered overlay dialog. Must be rendered as a child of a `position:
 * relative` Box. Ink only paints a cell when it holds an actual character —
 * flex gaps, Box padding, and blank margin rows are transparent, not opaque —
 * so every interior row here is built as one full-width, space-padded
 * string. That's what makes this genuinely occlude the background behind it
 * instead of letting it bleed through the modal's own whitespace. Ink also
 * only supports `backgroundColor` on `Text`, not `Box`, so the solid fill
 * is carried by every Text line rather than the outer container.
 */
export function Modal({ title, hint, bodyLines, width, height, columns, rows }: ModalProps) {
  const marginLeft = Math.max(0, Math.floor((columns - width) / 2));
  const marginTop = Math.max(0, Math.floor((rows - height) / 2));
  const contentWidth = width - SIDE_PADDING * 2;
  const gap = Math.max(0, contentWidth - title.length - hint.length);
  const sidePadding = ' '.repeat(SIDE_PADDING);
  const blankLine = ' '.repeat(width);
  const contentRows = 2 + bodyLines.length;
  const fillerRows = Math.max(0, height - contentRows);

  return (
    <Box
      position="absolute"
      marginLeft={marginLeft}
      marginTop={marginTop}
      width={width}
      height={height}
      flexDirection="column"
    >
      <Text backgroundColor={MODAL_BG}>
        {sidePadding}
        <Text bold color={ACCENT} backgroundColor={MODAL_BG}>
          {title}
        </Text>
        {' '.repeat(gap)}
        <Text dimColor backgroundColor={MODAL_BG}>
          {hint}
        </Text>
        {sidePadding}
      </Text>

      <Text backgroundColor={MODAL_BG}>{blankLine}</Text>
      {bodyLines.map((line) => (
        <Text key={line} backgroundColor={MODAL_BG}>
          {`${sidePadding}${line.padEnd(contentWidth)}${sidePadding}`}
        </Text>
      ))}
      {Array.from({ length: fillerRows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: filler rows are interchangeable blank lines
        <Text key={index} backgroundColor={MODAL_BG}>
          {blankLine}
        </Text>
      ))}
    </Box>
  );
}
