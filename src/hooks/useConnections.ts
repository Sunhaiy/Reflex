import { useEffect, useRef, useState } from 'react';
import { serialWriter } from '../shared/serialWriter';
import type { ServerCatalog } from '../shared/serverManagement';
import { managementText } from '../shared/managementLocale';
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
  const [catalog, setCatalog] = useState<ServerCatalog>({ groups: [], tags: [] });
  const managementReady = useRef(false);
  const [writer] = useState(() =>
    serialWriter<{ connections: SSHConnection[]; catalog: ServerCatalog }>(
      { connections: [], catalog: { groups: [], tags: [] } },
      (value) => {
        if (!managementReady.current)
          return Promise.reject(new Error('Server data could not be restored; restart before saving'));
        return window.electron.saveServerManagement(value);
      },
      (value) => {
        setConnections(value.connections);
        setCatalog(value.catalog);
      },
    ),
  );

  useEffect(() => {
    // Ancillary settings fail independently. Connections and categories restore together;
    // if either fails, block writes so an empty fallback cannot overwrite saved servers.
    const readKey = (key: StoreKey) =>
      window.electron.storeGet(key).catch((error) => {
        log.error(`[Boot] Could not read "${key}"`, error);
        return undefined;
      });

    void Promise.all([
      Promise.all([
        window.electron.storeGet('connections'),
        window.electron.storeGet('serverCatalog'),
        readKey('language'),
      ])
        .then(([stored, categories, language]) => {
          const c = categories as ServerCatalog | undefined;
          if (stored !== undefined && !Array.isArray(stored)) throw new Error('Invalid saved server list');
          if (categories !== undefined && !(c && Array.isArray(c.groups) && Array.isArray(c.tags)))
            throw new Error('Invalid saved categories');
          writer.restore({
            connections: Array.isArray(stored) ? stored : [],
            catalog:
              c && Array.isArray(c.groups) && Array.isArray(c.tags)
                ? c
                : {
                    groups: ['personal', 'company'].map((id) => ({
                      id,
                      name: managementText(String(language ?? 'en'), id as 'personal' | 'company'),
                    })),
                    tags: [],
                  },
          });
          managementReady.current = true;
        })
        .catch((error) => {
          log.error('[Boot] Could not restore server management data', error);
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
  }, [writer]);

  const upsert = async (connection: SSHConnection) => {
    await writer.update((current) => ({
      ...current,
      connections: current.connections.some((c) => c.id === connection.id)
        ? current.connections.map((c) => (c.id === connection.id ? connection : c))
        : [...current.connections, connection],
    }));
  };

  const remove = async (connectionId: string) => {
    await writer.update((current) => ({
      ...current,
      connections: current.connections.filter((c) => c.id !== connectionId),
    }));
  };

  const saveDraft = async (data: Partial<SSHConnection>) => {
    const next: ConnectionDraft = { data, savedAt: Date.now() };
    await window.electron.storeSet('connectionDraft', next);
    setDraft(next);
  };

  const clearDraft = async () => {
    await window.electron.storeDelete('connectionDraft');
    setDraft(null);
  };

  const markConnected = (connectionId: string) => {
    setLastConnectedAt((current) => {
      const next = { ...current, [connectionId]: Date.now() };
      void window.electron.storeSet('lastConnectedAt', next);
      return next;
    });
  };

  const updateManagement = (
    change: (current: { connections: SSHConnection[]; catalog: ServerCatalog }) => {
      connections: SSHConnection[];
      catalog: ServerCatalog;
    },
  ) => writer.update(change);
  const createCategory = async (kind: 'groups' | 'tags', name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Category name is required');
    let id = '';
    await writer.update((current) => {
      const existing = current.catalog[kind].find(
        (item) => item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
      );
      id = existing?.id ?? crypto.randomUUID();
      return existing
        ? current
        : { ...current, catalog: { ...current.catalog, [kind]: [...current.catalog[kind], { id, name: trimmed }] } };
    });
    return id;
  };
  return {
    connections,
    catalog,
    updateManagement,
    createCategory,
    draft,
    lastConnectedAt,
    restored,
    upsert,
    remove,
    saveDraft,
    clearDraft,
    markConnected,
  };
}
