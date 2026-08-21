import { GradientBox } from '../components/gradient-box.js';
import { MultilineTextInput } from '../components/multiline-text-input.js';

interface AgentPromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  busy: boolean;
  width: number;
}

export function AgentPromptInput({
  value,
  onChange,
  onSubmit,
  busy,
  width,
}: AgentPromptInputProps) {
  const focused = !busy;

  return (
    <GradientBox width={width} dim={!focused}>
      <MultilineTextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder="Message this agent…"
        focus={focused}
      />
    </GradientBox>
  );
}
