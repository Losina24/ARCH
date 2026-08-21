import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { GradientBox } from './gradient-box.js';

describe('GradientBox', () => {
  it('renders a rounded border of the exact given width around its content', () => {
    const { lastFrame } = render(
      <GradientBox width={20}>
        <Text>hi</Text>
      </GradientBox>,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    expect(lines[0]).toHaveLength(20);
    expect(lines[0].startsWith('╭')).toBe(true);
    expect(lines[0].endsWith('╮')).toBe(true);
    expect(lines[2].startsWith('╰')).toBe(true);
    expect(lines[2].endsWith('╯')).toBe(true);
    expect(frame).toContain('hi');
  });

  it('repeats the side border on every row when content spans multiple lines', () => {
    const { lastFrame } = render(
      <GradientBox width={20}>
        <Text>line one</Text>
        <Text>line two</Text>
        <Text>line three</Text>
      </GradientBox>,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('line one');
    expect(lines[2]).toContain('line two');
    expect(lines[3]).toContain('line three');
    for (const line of [lines[1], lines[2], lines[3]]) {
      expect(line.startsWith('│')).toBe(true);
      expect(line.endsWith('│')).toBe(true);
    }
  });
});
