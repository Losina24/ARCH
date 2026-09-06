import { GradientBox } from '../components/gradient-box.js';
import { MultilineTextInput } from '../components/multiline-text-input.js';

interface AgentPromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  busy: boolean;
  width: number;
  placeholder?: string;
}

export function AgentPromptInput({
  value,
  onChange,
  onSubmit,
  busy,
  width,
  placeholder = 'Message this agent…',
}: AgentPromptInputProps) {
  const focused = !busy;

  return (
    <GradientBox width={width} dim={!focused}>
      <MultilineTextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={placeholder}
        focus={focused}
      />
    </GradientBox>
  );
}
