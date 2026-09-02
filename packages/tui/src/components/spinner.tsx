import { Text } from 'ink';
import InkSpinner from 'ink-spinner';
import type { ComponentProps } from 'react';

interface SpinnerProps {
  color?: string;
  type?: ComponentProps<typeof InkSpinner>['type'];
}

export function Spinner({ color, type = 'dots' }: SpinnerProps) {
  return (
    <Text color={color}>
      <InkSpinner type={type} />
    </Text>
  );
}
