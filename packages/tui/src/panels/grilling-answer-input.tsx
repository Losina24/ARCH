import { GradientBox } from '../components/gradient-box.js';
import { MultilineTextInput } from '../components/multiline-text-input.js';

interface GrillingAnswerInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  busy: boolean;
  width: number;
}

export function GrillingAnswerInput({
  value,
  onChange,
  onSubmit,
  busy,
  width,
}: GrillingAnswerInputProps) {
  const focused = !busy;

  return (
    <GradientBox width={width} dim={!focused}>
      <MultilineTextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder="Type your answer, Enter to accept the recommendation, or /skip"
        focus={focused}
      />
    </GradientBox>
  );
}
