import type { TaskStatus } from '@arch/schemas';
import { Text } from 'ink';
import { statusColor, statusGlyph } from '../status-color.js';
import { Spinner } from './spinner.js';

export function StatusBadge({
  status,
  showLabel = true,
}: {
  status: TaskStatus;
  showLabel?: boolean;
}) {
  const color = statusColor(status);
  return (
    <Text>
      {status === 'in_progress' ? (
        <Spinner color={color} />
      ) : (
        <Text color={color}>{statusGlyph(status)}</Text>
      )}
      {showLabel ? <Text dimColor> {status}</Text> : null}
    </Text>
  );
}
