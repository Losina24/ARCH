import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { HOME_COMMANDS } from '../commands.js';
import { HelpModal } from './help-modal.js';

describe('HelpModal', () => {
  it('shows Help, esc to close and every command with its description', () => {
    const { lastFrame } = render(
      <Box position="relative" width={80} height={24}>
        <HelpModal columns={80} rows={24} />
      </Box>,
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Help');
    expect(frame).toContain('esc to close');
    for (const command of HOME_COMMANDS) {
      expect(frame).toContain(`/${command.name}`);
      expect(frame).toContain(command.description);
    }
  });
});
