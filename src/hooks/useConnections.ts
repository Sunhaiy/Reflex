import { useEffect, useState } from 'react';
import { log } from '../lib/logger';
import type { StoreKey } from '../shared/storeKeys';
import type { ConnectionDraft, SSHConnection } from '../shared/types';

/**
 * The saved server list and the two things stored alongside it: the half-finished
 * connection form, and when each server was last reached. Every change here is written
 * straight through to the store, so nothing is left only in memory.
 */
export function useConnections() {
  const [connections, setConnections] = useState<SSHConnection[]>([]);
  const [draft, setDraft] = useState<ConnectionDraft | null>(null);
  // Kept beside the connections rather than inside them, so the saved connection records
  // keep exactly the fields the user entered.
  const [lastConnectedAt, setLastConnectedAt] = useState<Record<string, number>>({});
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    // Read independently rather than through one Promise.all: a single rejected key took
    // the whole batch down with it, and the server list silently came back empty because
    // setConnections simply never ran.
    const readKey = (key: StoreKey) => window.electron.storeGet(key).catch((error) => {
      log.error(`[Boot] Could not read "${key}"`, error);
      return undefined;
    });

    void Promise.all([
      readKey('connections').then((stored) => {
        if (Array.isArray(stored)) setConnections(stored as SSHConnection[]);
      }),
      readKey('connectionDraft').then((stored) => {
        // Drafts saved by the old two-step wizard carry an extra `step` field, which is simply ignored.
        if (stored && typeof stored === 'object' && 'data' in stored) {
          setDraft(stored as ConnectionDraft);
        }
      }),
      readKey('lastConnectedAt').then((stored) => {
        if (stored && typeof stored === 'object') {
          setLastConnectedAt(stored as Record<string, number>);
        }
      }),
    ]).then(() => setRestored(true));
  }, []);

  const persist = async (next: SSHConnection[]) => {
    setConnections(next);
    await window.electron.storeSet('connections', next);
  };

  const upsert = async (connection: SSHConnection) => {
    const exists = connections.some((item) => item.id === connection.id);
    await persist(exists
      ? connections.map((item) => (item.id === connection.id ? connection : item))
      : [...connections, connection]);
  };

  const remove = async (connectionId: string) => {
    await persist(connections.filter((item) => item.id !== connectionId));
  };

  const saveDraft = async (data: Partial<SSHConnection>) => {
    const next: ConnectionDraft = { data, savedAt: Date.now() };
    setDraft(next);
    await window.electron.storeSet('connectionDraft', next);
  };

  const clearDraft = async () => {
    setDraft(null);
    await window.electron.storeDelete('connectionDraft').catch(() => undefined);
  };

  const markConnected = (connectionId: string) => {
    setLastConnectedAt((current) => {
      const next = { ...current, [connectionId]: Date.now() };
      void window.electron.storeSet('lastConnectedAt', next);
      return next;
    });
  };

  return { connections, draft, lastConnectedAt, restored, upsert, remove, saveDraft, clearDraft, markConnected };
}
