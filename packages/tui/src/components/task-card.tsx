import type { Task } from '@arch/schemas';
import { Box, Text } from 'ink';
import { statusGlyph } from '../status-color.js';
import { taskStyle } from '../task-style.js';
import { ACCENT } from '../theme.js';

export const TASK_CARD_WIDTH = 26;
// Narrow variant used when the terminal is too tight to fit a whole wave of
// full-size cards on one row: dropping the title (the widest, least critical
// line) buys enough width to keep more cards per row and avoid wrapping.
export const COMPACT_CARD_WIDTH = 16;

// Hand-drawn double-line top edge with the task id cut into it, like LegendBox
// does for panel titles — keeps the neon border color continuous around the id.
// When selected, the cursor glyphs replace the padding around the id so the
// highlight reads clearly even without color (e.g. copy/paste, low-color terms).
function topEdge(id: string, width: number, selected: boolean): string {
  const innerWidth = Math.max(0, width - 2);
  const legend = selected ? `❯${id}❯` : ` ${id} `;
  const trailingEquals = Math.max(0, innerWidth - 1 - legend.length);
  return `╔═${legend}${'═'.repeat(trailingEquals)}╗`;
}

interface TaskCardProps {
  task: Task;
  agentLabel: string | null;
  selected?: boolean;
  /** Drops the title line and shrinks to COMPACT_CARD_WIDTH — used when the
   * terminal is too narrow to fit a whole wave of full-size cards on a row. */
  compact?: boolean;
}

export function TaskCard({ task, agentLabel, selected = false, compact = false }: TaskCardProps) {
  const style = taskStyle(task.status);
  const borderColor = selected ? ACCENT : style.color;
  const width = compact ? COMPACT_CARD_WIDTH : TASK_CARD_WIDTH;

  return (
    <Box flexDirection="column" width={width}>
      <Text color={borderColor}>{topEdge(task.id, width, selected)}</Text>
      <Box
        borderStyle="double"
        borderTop={false}
        borderColor={borderColor}
        flexDirection="column"
        paddingX={1}
        width={width}
      >
        {!compact && (
          <Text
            wrap="truncate-end"
            color={style.color}
            bold={style.bold}
            italic={style.italic}
            strikethrough={style.strikethrough}
          >
            {task.title}
          </Text>
        )}
        <Text color={style.color}>
          {statusGlyph(task.status)} {task.status}
        </Text>
        <Text dimColor wrap="truncate-end">
          Agent: {agentLabel ?? '—'}
        </Text>
        <Text dimColor wrap="truncate-end">
          Retries: {task.retries}
        </Text>
      </Box>
    </Box>
  );
}
