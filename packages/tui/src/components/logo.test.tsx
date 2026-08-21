import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { Logo } from './logo.js';

describe('Logo', () => {
  it('renders the ARCH wordmark as multi-line neon glyph art', () => {
    const { lastFrame } = render(<Logo />);
    const frame = lastFrame() ?? '';
    expect(frame.split('\n').length).toBeGreaterThan(1);
    expect(frame).toContain('█');
    expect(frame).toContain('░');
  });
});
