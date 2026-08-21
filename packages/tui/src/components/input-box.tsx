import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { ACCENT } from '../theme.js';

interface InputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  prefix?: string;
  focused?: boolean;
}

export function InputBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  prefix,
  focused = true,
}: InputBoxProps) {
  return (
    <Box borderStyle="round" borderColor={focused ? ACCENT : 'gray'} paddingX={1}>
      {prefix ? <Text dimColor>{prefix}</Text> : null}
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={placeholder}
        focus={focused}
      />
    </Box>
  );
}
