import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { Modal } from './modal.js';

describe('Modal', () => {
  it('centers itself within the given columns/rows, has no border and shows the title, hint and content', () => {
    const { lastFrame } = render(
      <Box position="relative" width={40} height={16}>
        <Modal
          title="Help"
          hint="esc to close"
          bodyLines={['body line']}
          width={20}
          height={5}
          columns={40}
          rows={16}
        />
      </Box>,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');

    expect(frame).toContain('Help');
    expect(frame).toContain('esc to close');
    expect(frame).toContain('body line');
    expect(frame).not.toContain('╭');
    expect(frame).not.toContain('│');

    const titleRow = lines.findIndex((line) => line.includes('Help'));
    expect(titleRow).toBe(Math.floor((16 - 5) / 2));
    expect(lines[titleRow].indexOf('Help')).toBe(Math.floor((40 - 20) / 2) + 2);
  });

  it('fully occludes the background behind its interior — no gaps, no bleed-through', () => {
    const width = 20;
    const height = 5;
    const { lastFrame } = render(
      <Box position="relative" width={40} height={16} flexDirection="column">
        {Array.from({ length: 16 }, (_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static fixture rows, order never changes
          <Text key={row}>{'X'.repeat(40)}</Text>
        ))}
        <Modal
          title="Help"
          hint="esc to close"
          bodyLines={['/runs', '/settings']}
          width={width}
          height={height}
          columns={40}
          rows={16}
        />
      </Box>,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const top = Math.floor((16 - height) / 2);
    const left = Math.floor((40 - width) / 2);

    for (let row = top; row < top + height; row++) {
      const interior = lines[row].slice(left, left + width);
      expect(interior).not.toContain('X');
    }
  });
});
