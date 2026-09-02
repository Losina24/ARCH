import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { Spinner } from './spinner.js';

describe('Spinner', () => {
  it('renders a non-empty animated frame', () => {
    const { lastFrame } = render(<Spinner color="yellow" />);
    expect(lastFrame()?.length).toBeGreaterThan(0);
  });

  it('supports the slower fixed-width spinner used in long transcripts', () => {
    const { lastFrame } = render(
      <Box>
        <Spinner color="yellow" type="simpleDots" />
        <Text>activity</Text>
      </Box>,
    );
    expect(lastFrame()).toBe('.  activity');
  });
});
