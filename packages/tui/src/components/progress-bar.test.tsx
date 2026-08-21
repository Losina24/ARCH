import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { ProgressBar } from './progress-bar.js';

describe('ProgressBar', () => {
  it('renders an empty bar at 0%', () => {
    const frame = render(<ProgressBar ratio={0} width={20} />).lastFrame();
    expect(frame).toContain('0%');
    expect(frame).not.toContain('█');
  });

  it('renders a full bar at 100%', () => {
    const frame = render(<ProgressBar ratio={1} width={20} />).lastFrame();
    expect(frame).toContain('100%');
    expect(frame).not.toContain('░');
  });

  it('renders a partially filled bar for a ratio in between', () => {
    const frame = render(<ProgressBar ratio={0.5} width={20} />).lastFrame();
    expect(frame).toContain('50%');
    expect(frame).toContain('█');
    expect(frame).toContain('░');
  });

  it('clamps ratios outside the 0-1 range', () => {
    expect(render(<ProgressBar ratio={-1} width={20} />).lastFrame()).toContain('0%');
    expect(render(<ProgressBar ratio={2} width={20} />).lastFrame()).toContain('100%');
  });
});
