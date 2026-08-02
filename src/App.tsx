import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Loading02Icon } from "@hugeicons/core-free-icons";
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ConnectionForm } from './components/ConnectionForm';
import { TerminalConnecting } from './components/ConnectingOverlay';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ResizableLayout } from './components/ResizableLayout';
import { ServerHome } from './components/ServerHome';
import { StartupCover } from './components/StartupCover';
import { ThemeBackground } from './components/ThemeBackground';
import { TitleBar } from './components/TitleBar';
import { Modal } from './components/ui/modal';
import { appendActivity, clearActivity, startActivityCapture } from './lib/activityStore';
import { activityLine } from './components/ActivityLog';
import { bootReady } from './lib/bootProgress';
import { log } from './lib/logger';
import { flushUsage, queueUsage, startUsageTracking } from './lib/usageTracker';
import type { StoreKey } from './shared/storeKeys';
import type { ConnectionDraft, SSHConnection } from './shared/types';
import { useSettingsStore } from './store/settingsStore';
import { useTranslation } from './hooks/useTranslation';
import { useThemeStore } from './store/themeStore';

const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const RightPanel = lazy(() => import('./components/RightPanel').then((module) => ({ default: module.RightPanel })));
const FileBrowser = lazy(() => import('./components/FileBrowser').then((module) => ({ default: module.FileBrowser })));
const TerminalView = lazy(() => import('./components/TerminalView').then((module) => ({ default: module.TerminalView })));

interface AppSession {
  uniqueId: string;
  connection: SSHConnection;
  status: 'connecting' | 'connected' | 'disconnected';
  connectedAt?: number;
}

type AppPage = 'connections' | 'workspace' | 'settings';

const CONNECTION_RETRY_ATTEMPTS = 3;
const CONNECTION_RETRY_BASE_MS = 1000;

/**
 * Exponential with jitter rather than a fixed gap. The aborts seen against a throttled
 * host come from arriving too fast, and a constant retry keeps arriving at exactly the
 * same cadence; widening gaps give the server room to accept.
 */
function retryDelay(attempt: number) {
  const backoff = CONNECTION_RETRY_BASE_MS * 2 ** (attempt - 1);
  return Math.round(backoff * (0.75 + Math.random() * 0.5));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function refreshTerminal(sessionId: string) {
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent('terminal-refresh', { detail: { connectionId: sessionId } }));
  });
}

function normalizeConnection(data: SSHConnection): SSHConnection {
  const username = data.username || 'root';
  return {
    ...data,
    id: data.id || crypto.randomUUID(),
    name: data.name || (data.host ? `${username}@${data.host}` : 'New Server'),
    username,
  };
}

function connectionTransportChanged(previous: SSHConnection, next: SSHConnection) {
  const transportFields: Array<keyof SSHConnection> = [
    'host',
    'port',
    'username',
    'authType',
    'password',
    'privateKeyPath',
    'passphrase',
  ];
  return transportFields.some((field) => previous[field] !== next[field]);
}

function App() {
  const [page, setPage] = useState<AppPage>('connections');
  const [connections, setConnections] = useState<SSHConnection[]>([]);
  const [sessions, setSessions] = useState<AppSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [editingConnection, setEditingConnection] = useState<Partial<SSHConnection> | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null);
  // Kept beside the connections rather than inside them, so the saved connection
  // records keep exactly the fields the user entered.
  const [lastConnectedAt, setLastConnectedAt] = useState<Record<string, number>>({});
  const [connError, setConnError] = useState<string | null>(null);
  const autoConnectedRef = useRef(false);
  const sessionsRestoredRef = useRef(false);
  const connectedSinceRef = useRef(new Map<string, number>());

  const { t } = useTranslation();
  const initTheme = useThemeStore((state) => state.initTheme);
  const { initSettings, uiFontFamily, terminalFontFamily, language } = useSettingsStore();

  const finishConnectionUsage = (sessionId: string) => {
    const connectedAt = connectedSinceRef.current.get(sessionId);
    if (!connectedAt) return;
    connectedSinceRef.current.delete(sessionId);
    const duration = Math.max(0, Date.now() - connectedAt);
    queueUsage({
      totalConnectedMs: duration,
      longestConnectionMs: duration,
      activity: Math.max(1, Math.min(60, Math.round(duration / 60_000))),
    });
  };

  useEffect(() => startUsageTracking(), []);
  useEffect(() => startActivityCapture(), []);

  useEffect(() => {
    const finalizeSessions = () => {
      for (const sessionId of connectedSinceRef.current.keys()) finishConnectionUsage(sessionId);
      flushUsage();
    };
    window.addEventListener('beforeunload', finalizeSessions);
    return () => window.removeEventListener('beforeunload', finalizeSessions);
  }, []);

  useEffect(() => {
    // The startup cover waits on these three restores rather than on a timer. A failed
    // one still resolves — the shell falls back to defaults instead of hanging behind
    // the cover — but it lands in the log file either way.
    const restoreTheme = initTheme().catch((error) => {
      log.error('[Boot] Appearance restore failed', error);
    });

    const restoreSettings = initSettings().catch((error) => {
      log.error('[Boot] Settings restore failed', error);
    });

    // Read independently rather than through one Promise.all: a single rejected key
    // took the whole batch down with it, and the server list silently came back empty
    // because setConnections simply never ran.
    const readKey = (key: StoreKey) => window.electron.storeGet(key).catch((error) => {
      log.error(`[Boot] Could not read "${key}"`, error);
      return undefined;
    });

    const restoreConnections = Promise.all([
      readKey('connections').then((stored) => {
        if (Array.isArray(stored)) setConnections(stored as SSHConnection[]);
      }),
      readKey('connectionDraft').then((stored) => {
        // Drafts saved by the old two-step wizard carry an extra `step` field, which is simply ignored.
        if (stored && typeof stored === 'object' && 'data' in stored) {
          setConnectionDraft(stored as ConnectionDraft);
        }
      }),
      readKey('lastConnectedAt').then((stored) => {
        if (stored && typeof stored === 'object') {
          setLastConnectedAt(stored as Record<string, number>);
        }
      }),
    ]);

    void Promise.all([restoreTheme, restoreSettings, restoreConnections]).then(bootReady);
  }, [initSettings, initTheme]);

  useEffect(() => {
    if (!sessionsRestoredRef.current) return;
    const active = sessions.find((item) => item.uniqueId === activeSessionId);
    void window.electron.storeSet('openSessions', {
      ids: sessions.map((item) => item.connection.id),
      activeId: active?.connection.id ?? null,
    });
  }, [activeSessionId, sessions]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-sans', uiFontFamily);
    document.documentElement.lang = language;
  }, [language, uiFontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-mono', terminalFontFamily);
  }, [terminalFontFamily]);

  useEffect(() => {
    return window.electron.onSSHStatus((_event, { id, status }) => {
      if (status === 'connected' && !connectedSinceRef.current.has(id)) {
        connectedSinceRef.current.set(id, Date.now());
      }
      if (status === 'disconnected') finishConnectionUsage(id);
      setSessions((current) => current.map((session) =>
        session.uniqueId === id
          ? {
            ...session,
            status: status as AppSession['status'],
            connectedAt: status === 'connected' ? (session.connectedAt || Date.now()) : undefined,
          }
          : session
      ));
    });
  }, []);

  const persistConnections = async (next: SSHConnection[]) => {
    setConnections(next);
    await window.electron.storeSet('connections', next);
  };

  const handleConnect = async (connection: SSHConnection) => {
    const uniqueId = crypto.randomUUID();
    const newSession: AppSession = { uniqueId, connection, status: 'connecting' };
    setSessions((current) => [...current, newSession]);
    setActiveSessionId(uniqueId);
    setPage('workspace');

    let result: { success: boolean; error?: string } = { success: false, error: 'Connection failed' };
    for (let attempt = 1; attempt <= CONNECTION_RETRY_ATTEMPTS; attempt += 1) {
      try {
        result = await window.electron.connectSSH({
          connection,
          sessionId: uniqueId,
        });
      } catch (error) {
        result = { success: false, error: error instanceof Error ? error.message : String(error) };
      }

      if (result.success) break;
      if (attempt < CONNECTION_RETRY_ATTEMPTS) {
        const delay = retryDelay(attempt);
        // The overlay is otherwise silent through every attempt and its backoff, which
        // is what made a slow connect look like a hang.
        appendActivity('session', uniqueId, activityLine(
          `Attempt ${attempt} of ${CONNECTION_RETRY_ATTEMPTS} failed: ${result.error || 'unknown error'}`,
          'error',
        ));
        appendActivity('session', uniqueId, activityLine(
          `Retrying in ${(delay / 1000).toFixed(1)}s...`,
          'dim',
        ));
        await wait(delay);
      }
    }

    if (result.success) {
      setConnError(null);
      const connectedAt = connectedSinceRef.current.get(uniqueId) || Date.now();
      connectedSinceRef.current.set(uniqueId, connectedAt);
      setSessions((current) => current.map((session) =>
        session.uniqueId === uniqueId ? { ...session, status: 'connected', connectedAt } : session
      ));
      setLastConnectedAt((current) => {
        const next = { ...current, [connection.id]: Date.now() };
        void window.electron.storeSet('lastConnectedAt', next);
        return next;
      });
      return;
    }

    setSessions((current) => current.filter((session) => session.uniqueId !== uniqueId));
    setActiveSessionId(null);
    setPage('connections');
    setConnError(t('shell.connectFailedRetry', { count: CONNECTION_RETRY_ATTEMPTS, error: result.error || 'Unknown error' }));
  };

  const handleReconnect = async (sessionId: string) => {
    setSessions((current) => current.map((session) =>
      session.uniqueId === sessionId ? { ...session, status: 'connecting' } : session
    ));
    const result = await window.electron.sshReconnect(sessionId);
    if (result.success) {
      const connectedAt = Date.now();
      connectedSinceRef.current.set(sessionId, connectedAt);
      setSessions((current) => current.map((session) =>
        session.uniqueId === sessionId ? { ...session, status: 'connected', connectedAt } : session
      ));
    } else {
      setSessions((current) => current.map((session) =>
        session.uniqueId === sessionId ? { ...session, status: 'disconnected', connectedAt: undefined } : session
      ));
      setConnError(t('shell.reconnectFailed', { error: result.error || 'Unknown error' }));
    }
  };

  const handleSelectConnection = (connection: SSHConnection) => {
    const existingSession = sessions.find((session) => session.connection.id === connection.id);
    if (!existingSession) {
      void handleConnect(connection);
      return;
    }

    setActiveSessionId(existingSession.uniqueId);
    setPage('workspace');
    if (existingSession.status === 'disconnected') void handleReconnect(existingSession.uniqueId);
    refreshTerminal(existingSession.uniqueId);
  };

  const handleCloseSession = async (id: string) => {
    await window.electron.disconnectSSH(id).catch(() => undefined);
    finishConnectionUsage(id);
    clearActivity(id);
    const remaining = sessions.filter((session) => session.uniqueId !== id);
    setSessions(remaining);

    if (activeSessionId !== id) return;
    const nextSession = remaining[remaining.length - 1];
    setActiveSessionId(nextSession?.uniqueId || null);
    if (page === 'workspace') setPage(nextSession ? 'workspace' : 'connections');
  };

  const handleDeleteConnection = async (connection: SSHConnection) => {
    const session = sessions.find((item) => item.connection.id === connection.id);
    if (session) await handleCloseSession(session.uniqueId);
    await persistConnections(connections.filter((item) => item.id !== connection.id));
  };

  const handleSaveConnection = async (data: SSHConnection) => {
    const connection = normalizeConnection(data);
    const previousConnection = connections.find((item) => item.id === connection.id);
    const exists = Boolean(previousConnection);
    const next = exists
      ? connections.map((item) => item.id === connection.id ? connection : item)
      : [...connections, connection];
    await persistConnections(next);
    setEditingConnection(null);

    if (!exists) {
      setConnectionDraft(null);
      await window.electron.storeDelete('connectionDraft').catch(() => undefined);
      void handleConnect(connection);
      return;
    }

    const activeProfileSession = sessions.find((session) => session.connection.id === connection.id);
    if (!activeProfileSession || !previousConnection) return;

    if (connectionTransportChanged(previousConnection, connection)) {
      await handleCloseSession(activeProfileSession.uniqueId);
      void handleConnect(connection);
      return;
    }

    setSessions((current) => current.map((session) =>
      session.connection.id === connection.id ? { ...session, connection } : session
    ));
  };

  const handleSaveConnectionDraft = async (data: Partial<SSHConnection>) => {
    const draft: ConnectionDraft = { data, savedAt: Date.now() };
    setConnectionDraft(draft);
    await window.electron.storeSet('connectionDraft', draft);
    setEditingConnection(null);
  };

  const handleClearConnectionDraft = async () => {
    setConnectionDraft(null);
    await window.electron.storeDelete('connectionDraft').catch(() => undefined);
  };

  useEffect(() => {
    if (autoConnectedRef.current) return;
    autoConnectedRef.current = true;

    void (async () => {
      try {
        const autoReconnect = await window.electron.storeGet('autoReconnect');
        if (!autoReconnect) return;

        // Saved connections are read straight from the store rather than from state,
        // because this runs alongside the restore that populates that state.
        const [storedSessions, storedConnections] = await Promise.all([
          window.electron.storeGet('openSessions'),
          window.electron.storeGet('connections'),
        ]);
        const available = Array.isArray(storedConnections) ? storedConnections as SSHConnection[] : [];

        const saved = storedSessions as { ids?: unknown; activeId?: unknown } | undefined;
        const ids = Array.isArray(saved?.ids) ? (saved!.ids as unknown[]).filter((id): id is string => typeof id === 'string') : [];

        // Sequential on purpose: every tab appears immediately in 'connecting' state, so
        // the workspace is visibly whole right away, while the handshakes queue up rather
        // than arriving at one host all at once.
        for (const id of ids) {
          const connection = available.find((item) => item.id === id);
          if (connection) await handleConnect(connection);
        }

        const activeId = typeof saved?.activeId === 'string' ? saved.activeId : null;
        if (activeId) {
          setSessions((current) => {
            const target = current.find((item) => item.connection.id === activeId);
            if (target) setActiveSessionId(target.uniqueId);
            return current;
          });
        }
      } finally {
        sessionsRestoredRef.current = true;
      }
    })();
    // Run once when the shell starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="relative flex h-screen w-screen flex-col overflow-hidden border border-border/55 bg-transparent text-foreground">
        <ThemeBackground />
        <TitleBar
          page={page}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onHome={() => setPage('connections')}
          onSwitchSession={(id) => {
            setActiveSessionId(id);
            setPage('workspace');
            const session = sessions.find((item) => item.uniqueId === id);
            if (session?.status === 'disconnected') void handleReconnect(id);
            refreshTerminal(id);
          }}
          onCloseSession={(id) => void handleCloseSession(id)}
          onNewSession={() => setEditingConnection({})}
          onSettings={() => setPage('settings')}
        />

        <div className="relative z-10 min-h-0 flex-1 overflow-hidden bg-background/12">
            {connError && (
              <div className="glass-panel absolute left-1/2 top-4 z-40 flex max-w-[680px] -translate-x-1/2 items-start gap-3 rounded-2xl border-rose-500/25 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-rose-400">{t('shell.connectFailed')}</div>
                  <div className="mt-0.5 break-all text-[10px] leading-4 text-muted-foreground">{connError}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setConnError(null)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {page === 'connections' && (
              <ServerHome
                connections={connections}
                sessions={sessions}
                onConnect={handleSelectConnection}
                lastConnectedAt={lastConnectedAt}
                onNew={() => setEditingConnection({})}
                onEdit={(connection) => setEditingConnection(connection)}
                onDelete={(connection) => void handleDeleteConnection(connection)}
              />
            )}

            {page === 'settings' && (
              <div className="h-full overflow-hidden">
                <Suspense fallback={(
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-foreground" />
                  </div>
                )}>
                  <Settings />
                </Suspense>
              </div>
            )}

            <div
              className="absolute inset-0 flex flex-col overflow-hidden"
              style={{ display: page === 'workspace' && sessions.length > 0 ? 'flex' : 'none' }}
            >
              {sessions.map((session) => (
                <div
                  key={session.uniqueId}
                  className="absolute inset-0 flex flex-col"
                  style={{ display: session.uniqueId === activeSessionId ? 'flex' : 'none' }}
                >
                  <div className="min-h-0 flex-1">
                    <ResizableLayout
                      leftContent={
                        <ErrorBoundary name="FileBrowser">
                          <Suspense fallback={null}>
                            <FileBrowser connectionId={session.uniqueId} isConnected={session.status === 'connected'} />
                          </Suspense>
                        </ErrorBoundary>
                      }
                      middleContent={
                        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background/28">
                          <div className="relative min-h-0 flex-1 overflow-hidden">
                            <ErrorBoundary name="Terminal">
                              <Suspense fallback={null}>
                                <TerminalView connectionId={session.uniqueId} />
                              </Suspense>
                            </ErrorBoundary>
                          </div>
                          {session.status === 'connecting' && (
                            <TerminalConnecting connectionId={session.uniqueId} />
                          )}
                        </div>
                      }
                      rightContent={
                        // Kept mounted for every session, like the terminals above.
                        // Unmounting it on a tab switch tore down monitoring and threw
                        // away the collected chart history, so returning to a session
                        // meant a skeleton and a full reload. `active` pauses the polling
                        // instead, leaving the last readings on screen.
                        <ErrorBoundary name="RightPanel">
                          <Suspense fallback={null}>
                            <RightPanel
                              connectionId={session.uniqueId}
                              // Gated on 'connected', not just visible: starting a cycle
                              // against a session still handshaking fails outright and then
                              // sits out the whole 3s interval before trying again.
                              active={page === 'workspace'
                                && session.uniqueId === activeSessionId
                                && session.status === 'connected'}
                            />
                          </Suspense>
                        </ErrorBoundary>
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
        </div>
      </div>

      <Modal
        isOpen={editingConnection !== null}
        onClose={() => setEditingConnection(null)}
        title={editingConnection?.id ? t('shell.editConnection') : t('shell.newConnection')}
        size="lg"
      >
        <ConnectionForm
          initialData={editingConnection || {}}
          draft={editingConnection?.id ? null : connectionDraft}
          onSave={handleSaveConnection}
          onSaveDraft={handleSaveConnectionDraft}
          onClearDraft={handleClearConnectionDraft}
          onCancel={() => setEditingConnection(null)}
        />
      </Modal>

      <StartupCover />
    </>
  );
}

export default App;
