import type { Stdin } from 'ink-testing-library';
import { render } from 'ink-testing-library';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PASTE_CHAR_THRESHOLD, PASTE_FLUSH_MS } from './multiline-text-input.js';
import { MultilineTextInput } from './multiline-text-input.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function press(stdin: Stdin, sequence: string): Promise<void> {
  stdin.write(sequence);
  await tick();
}

// A paste chunk is buffered for PASTE_FLUSH_MS in case a real terminal splits it across
// more than one raw stdin read; wait past that window before asserting on paste-only input
// with no follow-up keystroke to trigger the immediate flush.
async function pressPaste(stdin: Stdin, text: string): Promise<void> {
  stdin.write(text);
  await new Promise((resolve) => setTimeout(resolve, PASTE_FLUSH_MS + 10));
}

async function type(stdin: Stdin, text: string): Promise<void> {
  for (const char of text) {
    await press(stdin, char);
  }
}

interface HarnessProps {
  onSubmit: (value: string) => void;
  initialValue?: string;
}

function Harness({ onSubmit, initialValue = '' }: HarnessProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <MultilineTextInput
      value={value}
      onChange={setValue}
      onSubmit={(submitted) => {
        onSubmit(submitted);
        setValue('');
      }}
    />
  );
}

describe('MultilineTextInput', () => {
  it('submits on plain Return', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness onSubmit={onSubmit} />);

    await tick();
    await type(stdin, 'fix bug');
    await press(stdin, '\r');

    expect(onSubmit).toHaveBeenCalledWith('fix bug');
  });

  it('inserts a newline on Option+Return instead of submitting', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);

    await tick();
    await type(stdin, 'line one');
    await press(stdin, '\x1b\r');
    await type(stdin, 'line two');

    expect(onSubmit).not.toHaveBeenCalled();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('line one');
    expect(frame).toContain('line two');
  });

  it('inserts pastes of 5 or fewer lines literally', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);

    await tick();
    await press(stdin, 'a\nb\nc\nd\ne');
    await press(stdin, '\r');

    expect(lastFrame()).not.toContain('Pasted text');
    expect(onSubmit).toHaveBeenCalledWith('a\nb\nc\nd\ne');
  });

  it('collapses a paste of more than 5 lines into a placeholder while keeping the real text', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);
    const pasted = 'a\nb\nc\nd\ne\nf';

    await tick();
    await pressPaste(stdin, pasted);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[Pasted text #1 +6 lines]');

    await press(stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith(pasted);
  });

  it('collapses a paste delivered as several fragmented stdin writes', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);

    await tick();
    // A real terminal can split one paste across more than one raw stdin read; each
    // write below lands as its own separate useInput call, like fragmented delivery.
    stdin.write('a\nb\nc\n');
    await tick();
    stdin.write('d\ne\nf');
    await new Promise((resolve) => setTimeout(resolve, PASTE_FLUSH_MS + 10));

    expect(lastFrame() ?? '').toContain('[Pasted text #1 +6 lines]');

    await press(stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith('a\nb\nc\nd\ne\nf');
  });

  it('strips bracketed-paste markers and never flashes them as literal text, even when the start marker arrives in its own fragment', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);
    const pasted = 'a\nb\nc\nd\ne\nf';

    await tick();
    // Real terminals send the bracketed-paste start marker as its own tiny write ahead
    // of the actual pasted content — this used to be short enough to fall under the
    // paste threshold and get flushed as literal "[200~" text before the rest arrived.
    stdin.write('\x1b[200~');
    await tick();
    stdin.write(pasted);
    await tick();
    stdin.write('\x1b[201~');
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('200~');
    expect(frame).not.toContain('201~');
    expect(frame).toContain('[Pasted text #1 +6 lines]');

    await press(stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith(pasted);
  });

  it('deletes the whole placeholder in one backspace right after it', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);
    const pasted = 'a\nb\nc\nd\ne\nf';

    await tick();
    await pressPaste(stdin, pasted);
    await type(stdin, 'x');
    await press(stdin, '\x7f'); // deletes the 'x' typed after the paste
    await press(stdin, '\x7f'); // deletes the whole placeholder token

    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Pasted text');

    await press(stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('starts a fresh paste counter after the parent clears the value on submit', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);
    const pasted = 'a\nb\nc\nd\ne\nf';

    await tick();
    await press(stdin, pasted);
    await press(stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith(pasted);
    await tick();
    expect(lastFrame() ?? '').not.toContain('Pasted text');

    await pressPaste(stdin, pasted);
    expect(lastFrame() ?? '').toContain('[Pasted text #1 +6 lines]');
  });

  it('jumps by word with Option+Left/Right (meta + arrow)', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness onSubmit={onSubmit} />);

    await tick();
    await type(stdin, 'foo bar baz');
    await press(stdin, '\x1b[1;3D'); // Option+Left
    await type(stdin, 'X');
    await press(stdin, '\r');

    expect(onSubmit).toHaveBeenCalledWith('foo bar Xbaz');
  });

  it('moves to line start/end with Ctrl+A / Ctrl+E', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness onSubmit={onSubmit} />);

    await tick();
    await type(stdin, 'hello');
    await press(stdin, '\x01'); // Ctrl+A
    await type(stdin, '>');
    await press(stdin, '\x05'); // Ctrl+E
    await type(stdin, '<');
    await press(stdin, '\r');

    expect(onSubmit).toHaveBeenCalledWith('>hello<');
  });

  it('deletes the previous word with Option+Backspace and Ctrl+W', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness onSubmit={onSubmit} />);

    await tick();
    await type(stdin, 'foo bar');
    await press(stdin, '\x1b\x7f'); // Option+Backspace
    await press(stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith('foo ');

    await type(stdin, 'foo bar');
    await press(stdin, '\x17'); // Ctrl+W
    await press(stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith('foo ');
  });

  it('deletes to line start with Ctrl+U', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness onSubmit={onSubmit} />);

    await tick();
    await type(stdin, 'foo bar');
    await press(stdin, '\x15'); // Ctrl+U
    await press(stdin, '\r');

    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('collapses a long single-line paste with no newlines into a placeholder', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);
    const pasted = 'x'.repeat(PASTE_CHAR_THRESHOLD + 1);

    await tick();
    await pressPaste(stdin, pasted);

    expect(lastFrame() ?? '').toContain('[Pasted text #1 +1 lines]');

    await press(stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith(pasted);
  });

  it('inserts a short single-line paste literally', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);
    const pasted = 'x'.repeat(PASTE_CHAR_THRESHOLD);

    await tick();
    await pressPaste(stdin, pasted);

    expect(lastFrame() ?? '').not.toContain('Pasted text');

    await press(stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith(pasted);
  });

  it('shows only the last 3 lines once content grows past that, cutting off the earliest', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);

    await tick();
    await type(stdin, 'line1');
    await press(stdin, '\x1b\r'); // Option+Return: newline, not submit
    await type(stdin, 'line2');
    await press(stdin, '\x1b\r');
    await type(stdin, 'line3');
    await press(stdin, '\x1b\r');
    await type(stdin, 'line4');

    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('line1');
    expect(frame).toContain('line2');
    expect(frame).toContain('line3');
    expect(frame).toContain('line4');

    await press(stdin, '\r');
    expect(onSubmit).toHaveBeenCalledWith('line1\nline2\nline3\nline4');
  });

  it('scrolls the window back up to keep the cursor visible when it moves above the bottom 3 lines', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);

    await tick();
    await type(stdin, 'line1');
    await press(stdin, '\x1b\r');
    await type(stdin, 'line2');
    await press(stdin, '\x1b\r');
    await type(stdin, 'line3');
    await press(stdin, '\x1b\r');
    await type(stdin, 'line4');

    // Walk the cursor from the end back into "line1" with plain Left arrow presses.
    for (let i = 0; i < 21; i++) {
      await press(stdin, '\x1b[D');
    }

    const frame = lastFrame() ?? '';
    expect(frame).toContain('line1');
    expect(frame).toContain('line2');
    expect(frame).toContain('line3');
    expect(frame).not.toContain('line4');
  });
});
