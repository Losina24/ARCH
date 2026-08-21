import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { LegendBox } from './legend-box.js';

describe('LegendBox', () => {
  it('cuts the label into the top border and renders the children inside', () => {
    const { lastFrame } = render(
      <LegendBox label="Models" width={40}>
        <Text>Architect: claude-opus-5</Text>
      </LegendBox>,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('┌─ Models');
    expect(frame).toContain('Architect: claude-opus-5');
    expect(frame).toContain('└');
  });

  it('pads out to fill an explicit height, even with little content', () => {
    const { lastFrame } = render(
      <LegendBox label="Console" width={30} height={10}>
        <Text>One line.</Text>
      </LegendBox>,
    );
    const frame = lastFrame() ?? '';
    expect(frame.split('\n')).toHaveLength(10);
  });
});
