import { Box, measureElement } from 'ink';
import type { DOMElement } from 'ink';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

interface ScrollBoxProps {
  height: number;
  scrollOffset: number;
  onContentHeight: (height: number) => void;
  children: ReactNode;
}

/**
 * Ink has no native scrollable viewport, so this clips a fixed-height
 * window with `overflow="hidden"` and shifts the full-height content up
 * inside it via a negative `marginTop` — the standard Ink scroll trick.
 * `measureElement` reports the content's true (unclipped) height back to
 * the caller so it can clamp `scrollOffset` and render scroll indicators.
 */
export function ScrollBox({ height, scrollOffset, onContentHeight, children }: ScrollBoxProps) {
  const contentRef = useRef<DOMElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      onContentHeight(measureElement(contentRef.current).height);
    }
  });

  return (
    <Box height={height} overflow="hidden" alignItems="flex-start">
      <Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={-scrollOffset}>
        {children}
      </Box>
    </Box>
  );
}
