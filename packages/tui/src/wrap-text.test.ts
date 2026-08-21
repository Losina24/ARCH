import { describe, expect, it } from 'vitest';
import { truncateLines, wrapPlainText } from './wrap-text.js';

describe('wrapPlainText', () => {
  it('wraps long words onto multiple lines without exceeding the width', () => {
    const lines = wrapPlainText('one two three four five', 10);
    expect(lines).toEqual(['one two', 'three four', 'five']);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
  });

  it('preserves existing newlines as paragraph breaks', () => {
    const lines = wrapPlainText('first line\nsecond line', 20);
    expect(lines).toEqual(['first line', 'second line']);
  });

  it('preserves blank lines between paragraphs', () => {
    expect(wrapPlainText('a\n\nb', 10)).toEqual(['a', '', 'b']);
  });

  it('keeps a single word longer than the width on its own line', () => {
    expect(wrapPlainText('supercalifragilisticexpialidocious', 10)).toEqual([
      'supercalifragilisticexpialidocious',
    ]);
  });
});

describe('truncateLines', () => {
  it('returns the lines unchanged when within the limit', () => {
    expect(truncateLines(['a', 'b'], 10)).toEqual(['a', 'b']);
  });

  it('cuts off at maxLines and appends an ellipsis line when there is more content', () => {
    const lines = ['1', '2', '3', '4'];
    expect(truncateLines(lines, 2)).toEqual(['1', '2', '…']);
  });
});
