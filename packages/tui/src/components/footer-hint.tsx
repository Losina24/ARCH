import { Text } from 'ink';

export function FooterHint({ hints }: { hints: string[] }) {
  return <Text dimColor>{hints.join(' · ')}</Text>;
}
