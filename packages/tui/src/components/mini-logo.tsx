import { Text } from 'ink';
import { neonGradientColor } from '../neon-gradient.js';

const WORD = 'ARCH';

/**
 * Single-line "ARCH" wordmark for headers/bars where the full multi-row
 * block-glyph Logo would be too tall — same left-to-right neon gradient,
 * one bold letter per cell.
 */
export function MiniLogo() {
  const letters = WORD.split('');

  return (
    <Text bold>
      {letters.map((letter, index) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed 4-letter constant, never reorders
          key={index}
          color={neonGradientColor(letters.length <= 1 ? 0 : index / (letters.length - 1))}
        >
          {letter}
        </Text>
      ))}
    </Text>
  );
}
