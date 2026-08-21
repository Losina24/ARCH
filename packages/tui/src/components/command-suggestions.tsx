import { Box, Text } from 'ink';
import type { HomeCommand } from '../commands.js';
import { ACCENT } from '../theme.js';

interface CommandSuggestionsProps {
  commands: HomeCommand[];
}

/**
 * Floating list of commands matching what's currently typed, shown right
 * below the prompt box while the input starts with `/`.
 */
export function CommandSuggestions({ commands }: CommandSuggestionsProps) {
  if (commands.length === 0) return null;

  return (
    <Box flexDirection="column">
      {commands.map((command) => (
        <Text key={command.name}>
          <Text color={ACCENT}>/{command.name}</Text>
          <Text dimColor> — {command.description}</Text>
        </Text>
      ))}
    </Box>
  );
}
