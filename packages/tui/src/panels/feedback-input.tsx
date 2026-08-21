import { GradientBox } from '../components/gradient-box.js';
import { MultilineTextInput } from '../components/multiline-text-input.js';

interface FeedbackInputProps {
  feedback: string;
  onFeedbackChange: (value: string) => void;
  onSubmitFeedback: (value: string) => void;
  busy: boolean;
  width: number;
}

export function FeedbackInput({
  feedback,
  onFeedbackChange,
  onSubmitFeedback,
  busy,
  width,
}: FeedbackInputProps) {
  const focused = !busy;

  return (
    <GradientBox width={width} dim={!focused}>
      <MultilineTextInput
        value={feedback}
        onChange={onFeedbackChange}
        onSubmit={onSubmitFeedback}
        placeholder="Type feedback, /approve, or /abort"
        focus={focused}
      />
    </GradientBox>
  );
}
