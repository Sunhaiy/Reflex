import { useEffect, useState } from 'react';

/**
 * Which slice of a uniform-height list is worth putting in the DOM.
 *
 * A directory like /usr/bin or a node_modules is thousands of entries, and each row is
 * roughly a dozen nodes once its icon is counted — enough to stall the pane for a
 * noticeable beat on open and on every keystroke in the filter box. Only the rows over
 * the viewport are rendered; a sized spacer holds the scrollbar honest.
 *
 * Rows must all be `rowPitch` tall, measured from one row's top to the next.
 */
export function useVirtualRows(count: number, rowPitch: number, overscan = 8) {
  // A callback ref rather than a RefObject: the scroller mounts behind a skeleton, so an
  // effect keyed on the ref object alone would run once against nothing and never again.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    if (!scroller) return;

    const sync = () => {
      setScrollTop(scroller.scrollTop);
      setViewport(scroller.clientHeight);
    };
    sync();

    scroller.addEventListener('scroll', sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', sync);
      observer.disconnect();
    };
  }, [scroller]);

  const { start, end } = visibleRange({ count, rowPitch, scrollTop, viewport, overscan });

  return {
    scrollerRef: setScroller,
    /** The scrolling element itself, for callers that need to move it. */
    scroller,
    start,
    end,
    totalHeight: count * rowPitch,
  };
}

interface RangeInput {
  count: number;
  rowPitch: number;
  scrollTop: number;
  viewport: number;
  overscan: number;
}

/**
 * The half-open window `[start, end)` of rows to render. Split out from the hook because
 * this is where the off-by-ones live and it is worth testing without a DOM.
 */
export function visibleRange({ count, rowPitch, scrollTop, viewport, overscan }: RangeInput) {
  if (count === 0) return { start: 0, end: 0 };

  // Before the first measurement the viewport reads 0, which would render nothing at
  // all; the overscan alone stands in for that one frame.
  const rowsInView = Math.ceil(viewport / rowPitch);
  // A stale scroll position — a taller directory replaced by a shorter one before the
  // browser clamps — must still resolve to a window that exists.
  const start = Math.min(Math.max(0, Math.floor(scrollTop / rowPitch) - overscan), count - 1);
  return { start, end: Math.min(count, start + rowsInView + overscan * 2) };
}
