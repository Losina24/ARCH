import { describe, expect, it } from 'vitest';
import { statusColor, statusGlyph } from './status-color.js';
import { ACCENT, ERROR, MUTED, REVIEW, SUCCESS, WAITING } from './theme.js';

describe('statusColor', () => {
  it.each([
    ['done', SUCCESS],
    ['failed', ERROR],
    ['awaiting_human', WAITING],
    ['blocked', MUTED],
    ['in_progress', REVIEW],
    ['needs_correction', REVIEW],
    ['in_review', ACCENT],
    ['ready', ACCENT],
    ['pending', MUTED],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(statusColor(status)).toBe(expected);
  });
});

describe('statusGlyph', () => {
  it.each([
    ['pending', '○'],
    ['ready', '◆'],
    ['blocked', '⊘'],
    ['in_progress', '◐'],
    ['in_review', '◎'],
    ['needs_correction', '✎'],
    ['done', '✓'],
    ['failed', '✗'],
    ['awaiting_human', '⏳'],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(statusGlyph(status)).toBe(expected);
  });
});
