import { useEffect, useState } from 'react';
import type { SSHConnection } from '../shared/types';

export interface Probe {
  /** Round trip to the SSH port in ms, or null when it could not be reached. */
  ms: number | null;
}

/** Green under 80ms, amber to 200ms, rose beyond — and rose again for unreachable. */
export function latencyClass(probe: Probe) {
  if (probe.ms === null) return 'text-rose-500';
  if (probe.ms < 80) return 'text-primary';
  if (probe.ms < 200) return 'text-amber-500';
  return 'text-rose-400';
}

const SWEEP_INTERVAL_MS = 60_000;
const BATCH_SIZE = 5;

/**
 * Reachability of each saved server, refreshed on a slow interval.
 *
 * Deliberately unhurried: a probe is a TCP handshake to the SSH port, and each one
 * briefly occupies one of that server's unauthenticated connection slots. Small batches
 * once a minute keep the panel current without behaving like a scanner.
 */
export function useHostProbes(connections: SSHConnection[]) {
  const [probes, setProbes] = useState<Record<string, Probe>>({});

  useEffect(() => {
    if (connections.length === 0) return;
    let cancelled = false;

    const sweep = async () => {
      const targets = [...connections];
      while (targets.length > 0 && !cancelled) {
        const batch = targets.splice(0, BATCH_SIZE);
        const results = await Promise.all(batch.map(async (connection) => {
          const result = await window.electron
            .probeHost({ host: connection.host, port: connection.port || 22 })
            .catch(() => ({ ok: false as const }));
          return [connection.id, { ms: result.ok ? result.ms ?? null : null }] as const;
        }));
        if (cancelled) return;
        setProbes((current) => ({ ...current, ...Object.fromEntries(results) }));
      }
    };

    void sweep();
    const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connections]);

  return probes;
}
