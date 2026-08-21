import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { StatusBar } from './status-bar.js';

describe('StatusBar', () => {
  it('renders the left context and the hints joined by a middle dot', () => {
    const { lastFrame } = render(
      <StatusBar left="/tmp/project" hints={['/help commands', 'esc back']} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/tmp/project');
    expect(frame).toContain('/help commands · esc back');
  });
});
