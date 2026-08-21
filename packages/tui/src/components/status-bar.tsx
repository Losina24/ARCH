import { Box, Text } from 'ink';
import { FooterHint } from './footer-hint.js';

interface StatusBarProps {
  left: string;
  hints: string[];
}

export function StatusBar({ left, hints }: StatusBarProps) {
  return (
    <Box justifyContent="space-between">
      <Text dimColor>{left}</Text>
      <FooterHint hints={hints} />
    </Box>
  );
}
