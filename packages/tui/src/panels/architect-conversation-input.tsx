import { GradientBox } from '../components/gradient-box.js';
import { MultilineTextInput } from '../components/multiline-text-input.js';

export type ConversationMode = 'definition' | 'grilling' | 'consultation';

const PLACEHOLDER: Record<ConversationMode, string> = {
  definition: 'Type feedback, /approve, or /abort',
  grilling: 'Type your answer, Enter to accept the recommendation, or /skip',
  consultation: 'Reply to the Architect, Enter to accept the recommendation, or /skip',
};

interface ArchitectConversationInputProps {
  mode: ConversationMode;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  busy: boolean;
  width: number;
}

/**
 * The single conversation surface with the Architect, regardless of which tab is active: it
 * behaves like the old FeedbackInput during `definition`, like the old GrillingAnswerInput during
 * `grilling`, and like a reply box for a pending stuck-task consultation otherwise. Replacing
 * three separate components with one keeps "you only ever talk to the Architect" true structurally
 * — there is nowhere else in this view a text input can appear.
 */
export function ArchitectConversationInput({
  mode,
  value,
  onChange,
  onSubmit,
  busy,
  width,
}: ArchitectConversationInputProps) {
  const focused = !busy;

  return (
    <GradientBox width={width} dim={!focused}>
      <MultilineTextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={PLACEHOLDER[mode]}
        focus={focused}
      />
    </GradientBox>
  );
}
