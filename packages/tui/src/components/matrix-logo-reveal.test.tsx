import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { MatrixLogoReveal } from './matrix-logo-reveal.js';

describe('MatrixLogoReveal', () => {
  it('completes instantly onto the fully-collapsed logo when durationMs is 0', async () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(
      <MatrixLogoReveal
        durationMs={0}
        viewportColumns={30}
        viewportRows={12}
        onComplete={onComplete}
      />,
    );

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const frame = lastFrame() ?? '';
    expect(frame.replace(/\s/g, '').length).toBeGreaterThan(0);
    // The canvas is never cropped — it always renders the full viewport grid, with the
    // logo silhouette lit at its resting row/col offset within it.
    expect(frame.split('\n').length).toBe(12);
  });

  it('reveals characters column by column, left columns ahead of right columns', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(
      <MatrixLogoReveal
        durationMs={900}
        viewportColumns={30}
        viewportRows={12}
        onComplete={onComplete}
      />,
    );

    expect(onComplete).not.toHaveBeenCalled();
    const lines = (lastFrame() ?? '').split('\n');
    // The logo silhouette (87 columns wide) is much wider than what's been revealed
    // so far, and Ink trims trailing blank cells — so a short line means only the
    // leftmost handful of columns have been reached, not the full width.
    expect(lines[0]?.trim().length).toBeGreaterThan(0);
    expect(lines.every((line) => line.length < 15)).toBe(true);
  });

  it('fades non-logo characters out as their column finishes, holds, collapses onto the logo, then completes', async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const { lastFrame } = render(
      <MatrixLogoReveal
        durationMs={900}
        viewportColumns={30}
        viewportRows={12}
        onComplete={onComplete}
      />,
    );

    // Mid-fill: some characters visible, animation still running.
    await vi.advanceTimersByTimeAsync(200);
    expect(lastFrame() ?? '').toMatch(/\S/);
    expect(onComplete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(onComplete).toHaveBeenCalledTimes(1);
    const frame = lastFrame() ?? '';
    expect(frame.replace(/\s/g, '').length).toBeGreaterThan(0);
    expect(frame.split('\n').length).toBe(12);
    vi.useRealTimers();
  });

  it('forms the logo screen-centered, then slides it up to its shifted resting row', async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    // gridRows = 20, logoRowCount = 7 → plain center row offset = 6, but with
    // restingBelowRows=4 the resting offset shifts up to 4.
    const { lastFrame } = render(
      <MatrixLogoReveal
        durationMs={900}
        viewportColumns={30}
        viewportRows={20}
        restingBelowRows={4}
        onComplete={onComplete}
      />,
    );

    // Grid is 20x87 → fillFrames = ceil((20*87 + stepsPerFrame*5) / stepsPerFrame) = 20
    // frames (~320ms at FRAME_MS=16), holding for the next 3 frames (~48ms) — 340ms lands
    // inside the holding window, before sliding starts.
    await vi.advanceTimersByTimeAsync(340);
    const holdingLines = (lastFrame() ?? '').split('\n');
    const holdingFirstLitRow = holdingLines.findIndex((line) => line.trim().length > 0);
    expect(holdingFirstLitRow).toBe(6);

    await vi.advanceTimersByTimeAsync(5000);
    expect(onComplete).toHaveBeenCalledTimes(1);
    const doneLines = (lastFrame() ?? '').split('\n');
    const doneFirstLitRow = doneLines.findIndex((line) => line.trim().length > 0);
    expect(doneFirstLitRow).toBe(4);
    vi.useRealTimers();
  });
});
