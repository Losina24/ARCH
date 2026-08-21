import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { InputBox } from './input-box.js';

describe('InputBox', () => {
  it('renders the prefix and current value inside a border', () => {
    const { lastFrame } = render(<InputBox prefix="/ " value="login" onChange={() => {}} />);
    const frame = lastFrame();
    expect(frame).toContain('/');
    expect(frame).toContain('login');
  });

  it('shows the placeholder when the value is empty', () => {
    const { lastFrame } = render(
      <InputBox value="" onChange={() => {}} placeholder="type to filter" />,
    );
    expect(lastFrame()).toContain('type to filter');
  });
});
