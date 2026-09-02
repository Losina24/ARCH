import { Box, measureElement } from 'ink';
import type { DOMElement } from 'ink';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

export interface ScrollMetrics {
  contentHeight: number;
  viewportHeight: number;
}

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

interface TailScrollBoxProps {
  height: number;
  children: ReactNode;
}

/**
 * Read-only viewport that always follows the end of growing output. Interactive consoles use the
 * controlled ScrollBox directly; this variant is for compact side-by-side previews where the
 * latest activity matters more than independent keyboard navigation.
 */
export function TailScrollBox({ height, children }: TailScrollBoxProps) {
  const [contentHeight, setContentHeight] = useState(0);
  const scrollOffset = Math.max(0, contentHeight - height);

  return (
    <ScrollBox height={height} scrollOffset={scrollOffset} onContentHeight={setContentHeight}>
      {children}
    </ScrollBox>
  );
}
