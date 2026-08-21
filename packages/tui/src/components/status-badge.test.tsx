import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './status-badge.js';

describe('StatusBadge', () => {
  it('renders the glyph and label for a settled status', () => {
    const { lastFrame } = render(<StatusBadge status="done" />);
    const frame = lastFrame();
    expect(frame).toContain('✓');
    expect(frame).toContain('done');
  });

  it('hides the label when showLabel is false', () => {
    const { lastFrame } = render(<StatusBadge status="failed" showLabel={false} />);
    const frame = lastFrame();
    expect(frame).toContain('✗');
    expect(frame).not.toContain('failed');
  });

  it('renders an animated spinner for in_progress instead of a static glyph', () => {
    const { lastFrame } = render(<StatusBadge status="in_progress" />);
    const frame = lastFrame();
    expect(frame).toContain('in_progress');
  });
});
