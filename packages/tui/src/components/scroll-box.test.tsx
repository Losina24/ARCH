import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ScrollBox, TailScrollBox } from './scroll-box.js';

function Lines({ count }: { count: number }) {
  return (
    <Box flexDirection="column">
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length synthetic content for the test
        <Text key={index}>{`line ${index}`}</Text>
      ))}
    </Box>
  );
}

describe('ScrollBox', () => {
  it('clips content to the given height and reports the full content height', async () => {
    const onContentHeight = vi.fn();
    const { lastFrame } = render(
      <ScrollBox height={2} scrollOffset={0} onContentHeight={onContentHeight}>
        <Lines count={5} />
      </ScrollBox>,
    );

    await vi.waitFor(() => expect(onContentHeight).toHaveBeenCalledWith(5));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('line 0');
    expect(frame).toContain('line 1');
    expect(frame).not.toContain('line 2');
  });

  it('shifts the visible window down as scrollOffset increases', () => {
    const { lastFrame } = render(
      <ScrollBox height={2} scrollOffset={2} onContentHeight={vi.fn()}>
        <Lines count={5} />
      </ScrollBox>,
    );

    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('line 0');
    expect(frame).toContain('line 2');
    expect(frame).toContain('line 3');
    expect(frame).not.toContain('line 4');
  });

  it('keeps a tail viewport pinned to the newest lines as content grows', async () => {
    const { lastFrame, rerender } = render(
      <TailScrollBox height={2}>
        <Lines count={5} />
      </TailScrollBox>,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('line 4'));
    expect(lastFrame()).not.toContain('line 0');

    rerender(
      <TailScrollBox height={2}>
        <Lines count={6} />
      </TailScrollBox>,
    );
    await vi.waitFor(() => expect(lastFrame()).toContain('line 5'));
    expect(lastFrame()).not.toContain('line 3');
  });
});
