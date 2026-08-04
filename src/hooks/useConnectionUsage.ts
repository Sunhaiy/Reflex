import { useEffect, useRef } from 'react';
import { flushUsage, queueUsage } from '../lib/usageTracker';

/**
 * Turns session lifetimes into the usage totals the home page charts.
 *
 * The start times live in a ref rather than in state: nothing on screen reads them, and
 * a session that connects and closes between two renders still has to be counted.
 */
export function useConnectionUsage() {
  const connectedSince = useRef(new Map<string, number>());

  /**
   * Starts the clock for a session, or returns the time already recorded for it. The
   * status event and the connect call both land here, and whichever arrives first wins.
   */
  const startConnectionUsage = (sessionId: string) => {
    const existing = connectedSince.current.get(sessionId);
    if (existing) return existing;
    const now = Date.now();
    connectedSince.current.set(sessionId, now);
    return now;
  };

  const finishConnectionUsage = (sessionId: string) => {
    const connectedAt = connectedSince.current.get(sessionId);
    if (!connectedAt) return;
    connectedSince.current.delete(sessionId);
    const duration = Math.max(0, Date.now() - connectedAt);
    queueUsage({
      totalConnectedMs: duration,
      longestConnectionMs: duration,
      // Charted in minutes, but a short session should still register as a visit.
      activity: Math.max(1, Math.min(60, Math.round(duration / 60_000))),
    });
  };

  // Quitting is the ordinary way a session ends, and the queued totals would otherwise
  // go with the window.
  useEffect(() => {
    const finalize = () => {
      for (const sessionId of [...connectedSince.current.keys()]) finishConnectionUsage(sessionId);
      flushUsage();
    };
    window.addEventListener('beforeunload', finalize);
    return () => window.removeEventListener('beforeunload', finalize);
  }, []);

  return { startConnectionUsage, finishConnectionUsage };
}
