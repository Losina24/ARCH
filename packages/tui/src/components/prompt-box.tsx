import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useTerminalColumns } from '../hooks/use-terminal-columns.js';
import { ARCH_LOGO_WIDTH } from '../logo.js';
import { GradientBox } from './gradient-box.js';
import { MultilineTextInput } from './multiline-text-input.js';

interface PromptBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  hint: ReactNode;
  dim?: boolean;
}

// Matches the rendered width of the ARCH wordmark so the input feels sized to the logo above it.
export const PROMPT_BOX_MAX_WIDTH = ARCH_LOGO_WIDTH;
const MIN_WIDTH = 24;
const SIDE_MARGIN = 4;

export function PromptBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  hint,
  dim = false,
}: PromptBoxProps) {
  const columns = useTerminalColumns();
  const width = Math.max(MIN_WIDTH, Math.min(PROMPT_BOX_MAX_WIDTH, columns - SIDE_MARGIN));

  return (
    <Box flexDirection="column" width={width}>
      <GradientBox width={width} dim={dim}>
        <MultilineTextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          focus={!dim}
        />
      </GradientBox>
      <Box marginTop={1} paddingLeft={1}>
        {typeof hint === 'string' ? <Text dimColor>{hint}</Text> : hint}
      </Box>
    </Box>
  );
}
