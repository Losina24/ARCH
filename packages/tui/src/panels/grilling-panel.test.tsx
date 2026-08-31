import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { GrillingPanel } from './grilling-panel.js';

describe('GrillingPanel', () => {
  it('renders the question and the recommendation', () => {
    const { lastFrame } = render(
      <GrillingPanel
        question="Which database should this use?"
        recommendation="PostgreSQL"
        width={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Which database should this use?');
    expect(frame).toContain('PostgreSQL');
    expect(frame).toContain('Grilling');
  });
});
