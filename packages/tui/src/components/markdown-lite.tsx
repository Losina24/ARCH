import { Box, Text } from 'ink';
import { CODE, EMPHASIS, HEADING } from '../theme.js';

function stripHeading(line: string): string | null {
  const match = line.match(/^#{1,6}\s+(.*)$/);
  return match ? match[1] : null;
}

function normalizeBullet(line: string): string | null {
  const match = line.match(/^(\s*)[-*]\s+(.*)$/);
  return match ? `${match[1]}• ${match[2]}` : null;
}

// Splits a line on `inline code` and **emphasized** spans so each can be
// colored separately from the surrounding prose.
function renderInline(line: string, keyPrefix: string) {
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter((part) => part.length > 0);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <Text key={key} color={CODE} italic>
          {part.slice(1, -1)}
        </Text>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={key} color={EMPHASIS} bold>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return <Text key={key}>{part}</Text>;
  });
}

export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        const heading = stripHeading(line);
        if (heading !== null) {
          return (
            <Box key={`${index}-${line}`} marginTop={index > 0 ? 1 : 0}>
              <Text bold color={HEADING}>
                {renderInline(heading, `h${index}`)}
              </Text>
            </Box>
          );
        }

        const bullet = normalizeBullet(line);
        return <Text key={`${index}-${line}`}>{renderInline(bullet ?? line, `l${index}`)}</Text>;
      })}
    </Box>
  );
}
