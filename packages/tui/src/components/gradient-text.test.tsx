import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { GradientText } from './gradient-text.js';

describe('GradientText', () => {
  it('renders the given text unchanged', () => {
    const { lastFrame } = render(<GradientText>Architect definition</GradientText>);
    expect(lastFrame()).toContain('Architect definition');
  });
});
