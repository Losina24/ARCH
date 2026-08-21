import { HOME_COMMANDS } from '../commands.js';
import { Modal } from './modal.js';
import { PROMPT_BOX_MAX_WIDTH } from './prompt-box.js';

interface HelpModalProps {
  columns: number;
  rows: number;
}

const HINT = 'esc to close';
const TITLE = 'Help';

const COMMAND_LINES = HOME_COMMANDS.map(
  (command) => `/${command.name.padEnd(10)} ${command.description}`,
);
const CONTENT_WIDTH = Math.max(
  TITLE.length + 2 + HINT.length,
  ...COMMAND_LINES.map((line) => line.length),
);

// At least as wide as PromptBox so the modal fully covers its border where they overlap,
// instead of slicing through it.
const WIDTH = Math.max(CONTENT_WIDTH + 4, PROMPT_BOX_MAX_WIDTH + 4);
const HEIGHT = COMMAND_LINES.length + 2;

export function HelpModal({ columns, rows }: HelpModalProps) {
  return (
    <Modal
      title={TITLE}
      hint={HINT}
      bodyLines={COMMAND_LINES}
      width={WIDTH}
      height={HEIGHT}
      columns={columns}
      rows={rows}
    />
  );
}
