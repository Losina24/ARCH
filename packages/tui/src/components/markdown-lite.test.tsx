import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { MarkdownLite } from './markdown-lite.js';

describe('MarkdownLite', () => {
  it('strips heading hashes', () => {
    const { lastFrame } = render(<MarkdownLite text="# Project brief" />);
    const frame = lastFrame();
    expect(frame).toContain('Project brief');
    expect(frame).not.toContain('#');
  });

  it('normalizes dash and star bullets to a bullet glyph', () => {
    const { lastFrame } = render(<MarkdownLite text={'- first\n* second'} />);
    const frame = lastFrame();
    expect(frame).toContain('• first');
    expect(frame).toContain('• second');
  });

  it('passes plain lines through unchanged', () => {
    const { lastFrame } = render(<MarkdownLite text="Just a plain line." />);
    expect(lastFrame()).toContain('Just a plain line.');
  });

  it('strips the backticks off inline code spans', () => {
    const { lastFrame } = render(<MarkdownLite text="Run `npm install` first." />);
    const frame = lastFrame();
    expect(frame).toContain('Run npm install first.');
    expect(frame).not.toContain('`');
  });

  it('strips the asterisks off emphasized spans', () => {
    const { lastFrame } = render(<MarkdownLite text="This is **important**, note it." />);
    const frame = lastFrame();
    expect(frame).toContain('This is important, note it.');
    expect(frame).not.toContain('**');
  });
});
