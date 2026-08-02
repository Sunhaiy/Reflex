import { describe, expect, it } from 'vitest';
import { visibleRange } from '../useVirtualRows';

const PITCH = 30;
const base = { rowPitch: PITCH, overscan: 8 };

describe('visibleRange', () => {
  it('renders nothing for an empty list', () => {
    expect(visibleRange({ ...base, count: 0, scrollTop: 0, viewport: 600 })).toEqual({ start: 0, end: 0 });
  });

  it('starts at the top before the viewport has been measured', () => {
    // The observer has not fired yet, so only the overscan stands in.
    expect(visibleRange({ ...base, count: 5000, scrollTop: 0, viewport: 0 }))
      .toEqual({ start: 0, end: 16 });
  });

  it('covers the viewport plus overscan on both sides', () => {
    // 600px of viewport is 20 rows; scrolled to row 100.
    const { start, end } = visibleRange({ ...base, count: 5000, scrollTop: 100 * PITCH, viewport: 600 });
    expect(start).toBe(92);
    expect(end).toBe(128);
    // Every row the user can actually see is inside the window.
    expect(start).toBeLessThanOrEqual(100);
    expect(end).toBeGreaterThanOrEqual(120);
  });

  it('never starts before the first row', () => {
    expect(visibleRange({ ...base, count: 5000, scrollTop: 60, viewport: 600 }).start).toBe(0);
  });

  it('clamps the end to the number of rows', () => {
    const { end } = visibleRange({ ...base, count: 30, scrollTop: 0, viewport: 6000 });
    expect(end).toBe(30);
  });

  it('still yields a window that exists when the list shrank under a stale scroll position', () => {
    // The user was deep in a long directory; a short one replaced it before the browser
    // clamped scrollTop. Reading past the end here would render nothing at all.
    const { start, end } = visibleRange({ ...base, count: 3, scrollTop: 100 * PITCH, viewport: 600 });
    expect(start).toBe(2);
    expect(end).toBe(3);
  });

  it('renders a whole short list in one window', () => {
    expect(visibleRange({ ...base, count: 12, scrollTop: 0, viewport: 600 }))
      .toEqual({ start: 0, end: 12 });
  });

  it('keeps a partially scrolled row in view', () => {
    // Halfway through row 40: floor() must pick 40, not 41.
    const { start } = visibleRange({ ...base, count: 5000, scrollTop: 40 * PITCH + 15, viewport: 600 });
    expect(start).toBe(32);
  });
});
