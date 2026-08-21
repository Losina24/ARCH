import { Text } from 'ink';
import { MUTED } from '../theme.js';

export interface CommandHint {
  key: string;
  label: string;
}

/**
 * Renders each command as `<key in gray> <description in the default
 * foreground>`, separated by a dim divider — the command itself reads as
 * secondary, the description as the primary, readable text.
 */
export function CommandHints({ hints }: { hints: CommandHint[] }) {
  return (
    <Text>
      {hints.map((hint, index) => (
        <Text key={hint.key}>
          {index > 0 && <Text dimColor> · </Text>}
          <Text color={MUTED}>{hint.key}</Text>
          <Text> {hint.label}</Text>
        </Text>
      ))}
    </Text>
  );
}
