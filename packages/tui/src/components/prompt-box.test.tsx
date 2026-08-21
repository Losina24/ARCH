import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { PromptBox } from './prompt-box.js';

describe('PromptBox', () => {
  it('renders the value and hint inside a bordered box', () => {
    const { lastFrame } = render(
      <PromptBox value="fix bug" onChange={() => {}} hint="Enter to start a run" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('╭');
    expect(frame).toContain('fix bug');
    expect(frame).toContain('Enter to start a run');
  });

  it('shows the placeholder when the value is empty', () => {
    const { lastFrame } = render(
      <PromptBox value="" onChange={() => {}} placeholder="Describe your task…" hint="" />,
    );
    expect(lastFrame()).toContain('Describe your task…');
  });
});
