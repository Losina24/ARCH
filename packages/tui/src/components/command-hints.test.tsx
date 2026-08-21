import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { CommandHints } from './command-hints.js';

describe('CommandHints', () => {
  it('renders each command key and its description', () => {
    const { lastFrame } = render(
      <CommandHints
        hints={[
          { key: 'Tab', label: 'switch page' },
          { key: 'Esc', label: 'back' },
        ]}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Tab');
    expect(frame).toContain('switch page');
    expect(frame).toContain('Esc');
    expect(frame).toContain('back');
  });
});
