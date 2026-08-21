import { Text } from 'ink';
import { SUCCESS } from '../theme.js';

interface ProgressBarProps {
  ratio: number;
  width: number;
  color?: string;
}

const FILLED = '█';
const EMPTY = '░';
// " 100%" — the widest the trailing percentage label can get.
const PERCENT_WIDTH = 5;

export function ProgressBar({ ratio, width, color = SUCCESS }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const percent = Math.round(clamped * 100);
  const barWidth = Math.max(1, width - PERCENT_WIDTH);
  const filled = Math.round(clamped * barWidth);
  const empty = Math.max(0, barWidth - filled);

  return (
    <Text>
      <Text color={color}>{FILLED.repeat(filled)}</Text>
      <Text dimColor>{EMPTY.repeat(empty)}</Text>
      <Text> {String(percent).padStart(3)}%</Text>
    </Text>
  );
}
