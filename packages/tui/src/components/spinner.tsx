import { Text } from 'ink';
import InkSpinner from 'ink-spinner';

export function Spinner({ color }: { color?: string }) {
  return (
    <Text color={color}>
      <InkSpinner type="dots" />
    </Text>
  );
}
