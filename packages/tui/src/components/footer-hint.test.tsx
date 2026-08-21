import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { FooterHint } from './footer-hint.js';

describe('FooterHint', () => {
  it('joins hints with a middle dot separator', () => {
    const { lastFrame } = render(<FooterHint hints={['esc: back', 'enter: open']} />);
    expect(lastFrame()).toBe('esc: back · enter: open');
  });
});
