/**
 * Greedy word-wrap for plain text. Ink's own <Text> wrapping happens after
 * render, so a preview that must be truncated to an exact line count needs
 * its own pre-render wrap to know where those lines actually fall.
 */
export function wrapPlainText(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > safeWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }

  return lines;
}

/** Keeps at most `maxLines`, appending an ellipsis line when content was cut off. */
export function truncateLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), '…'];
}
