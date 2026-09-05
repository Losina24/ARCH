import { Box, Text } from 'ink';
import type { HomeCommand } from '../commands.js';
import { ACCENT, SELECTION_CURSOR } from '../theme.js';

interface CommandSuggestionsProps {
  commands: HomeCommand[];
  /** Index of the arrow-key-highlighted command, if any. */
  selectedIndex?: number;
}

/**
 * Floating list of commands matching what's currently typed, shown right
 * below the prompt box while the input starts with `/`. When `selectedIndex`
 * is given, that row is prefixed with the same selection cursor used by the
 * runs list, so arrow-key navigation reads consistently across the app.
 */
export function CommandSuggestions({ commands, selectedIndex }: CommandSuggestionsProps) {
  if (commands.length === 0) return null;

  return (
    <Box flexDirection="column">
      {commands.map((command, index) => (
        <Text key={command.name}>
          {index === selectedIndex ? `${SELECTION_CURSOR} ` : '  '}
          <Text bold={index === selectedIndex} color={ACCENT}>
            /{command.name}
          </Text>
          <Text dimColor> — {command.description}</Text>
        </Text>
      ))}
    </Box>
  );
}
