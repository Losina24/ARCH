import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackInput } from './feedback-input.js';

const noop = () => {
  /* no-op */
};

describe('FeedbackInput', () => {
  it('renders the placeholder', () => {
    const { lastFrame } = render(
      <FeedbackInput
        feedback=""
        onFeedbackChange={noop}
        onSubmitFeedback={vi.fn()}
        busy={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain('Type feedback, /approve, or /abort');
  });

  it('shows the current draft text', () => {
    const { lastFrame } = render(
      <FeedbackInput
        feedback="add oauth"
        onFeedbackChange={noop}
        onSubmitFeedback={vi.fn()}
        busy={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain('add oauth');
  });

  it('stays rendered while a request is in flight', () => {
    const { lastFrame } = render(
      <FeedbackInput
        feedback=""
        onFeedbackChange={noop}
        onSubmitFeedback={vi.fn()}
        busy
        width={80}
      />,
    );
    expect(lastFrame()).toContain('Type feedback, /approve, or /abort');
  });
});
