import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { Spinner } from './spinner.js';

describe('Spinner', () => {
  it('renders a non-empty animated frame', () => {
    const { lastFrame } = render(<Spinner color="yellow" />);
    expect(lastFrame()?.length).toBeGreaterThan(0);
  });
});
