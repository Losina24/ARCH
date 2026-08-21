import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { MiniLogo } from './mini-logo.js';

describe('MiniLogo', () => {
  it('renders the ARCH wordmark on a single line', () => {
    const { lastFrame } = render(<MiniLogo />);
    const frame = lastFrame() ?? '';
    expect(frame.split('\n').length).toBe(1);
    expect(frame).toContain('ARCH');
  });
});
