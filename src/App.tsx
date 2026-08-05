import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Loading02Icon } from "@hugeicons/core-free-icons";
import { lazy, Suspense, useEffect, useState } from 'react';
import { ConnectionForm } from './components/ConnectionForm';
import { ServerHome } from './components/ServerHome';
import { Workspace } from './components/Workspace';
import { StartupCover } from './components/StartupCover';
import { AppUpdatePrompt } from './components/AppUpdatePrompt';
import { ThemeBackground } from './components/ThemeBackground';
import { TitleBar } from './components/TitleBar';
import { Modal } from './components/ui/modal';
import { startActivityCapture } from './lib/activityStore';
import { connectionTransportChanged, normalizeConnection } from './lib/connectionUtils';
import { bootReady } from './lib/bootProgress';
import { log } from './lib/logger';
import { startUsageTracking } from './lib/usageTracker';
import { useConnections } from './hooks/useConnections';
import { useSessions } from './hooks/useSessions';
import type { SSHConnection } from './shared/types';
import { useSettingsStore } from './store/settingsStore';
import { useTranslation } from './hooks/useTranslation';
import { useThemeStore } from './store/themeStore';

const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));

type AppPage = 'connections' | 'workspace' | 'settings';

function App() {
  const [page, setPage] = useState<AppPage>('connections');
  const [editingConnection, setEditingConnection] = useState<Partial<SSHConnection> | null>(null);
  const [appearanceRestored, setAppearanceRestored] = useState(false);

  const { t } = useTranslation();
  const initTheme = useThemeStore((state) => state.initTheme);
  const { initSettings, uiFontFamily, terminalFontFamily, language } = useSettingsStore();

  const {
    connections,
    draft,
    lastConnectedAt,
    restored: connectionsRestored,
    upsert,
    remove,
    saveDraft,
    clearDraft,
    markConnected,
  } = useConnections();

  const {
    sessions,
    activeSessionId,
    error: connError,
    dismissError,
    connect,
    focusSession,
    openConnection,
    closeSession,
    applyConnectionEdit,
  } = useSessions({
    openWorkspace: () => setPage('workspace'),
    // Settings is a deliberate detour, so only the workspace itself gets pulled away.
    leaveWorkspace: () => setPage((current) => (current === 'workspace' ? 'connections' : current)),
    onConnected: (connection) => markConnected(connection.id),
  });

  useEffect(() => startUsageTracking(), []);
  useEffect(() => startActivityCapture(), []);

  useEffect(() => {
    // A failed restore still resolves — the shell falls back to defaults instead of
    // hanging behind the cover — but it lands in the log file either way.
    const restoreTheme = initTheme().catch((error) => {
      log.error('[Boot] Appearance restore failed', error);
    });

    const restoreSettings = initSettings().catch((error) => {
      log.error('[Boot] Settings restore failed', error);
    });

    void Promise.all([restoreTheme, restoreSettings]).then(() => setAppearanceRestored(true));
  }, [initSettings, initTheme]);

  // The startup cover waits on the restores rather than on a timer, so it leaves when the
  // shell is genuinely usable.
  useEffect(() => {
    if (appearanceRestored && connectionsRestored) bootReady();
  }, [appearanceRestored, connectionsRestored]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-sans', uiFontFamily);
    document.documentElement.lang = language;
  }, [language, uiFontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-mono', terminalFontFamily);
  }, [terminalFontFamily]);

  const handleSaveConnection = async (data: SSHConnection) => {
    const connection = normalizeConnection(data);
    const previous = connections.find((item) => item.id === connection.id);
    await upsert(connection);
    setEditingConnection(null);

    // A brand new server is connected straight away; the draft that produced it is done.
    if (!previous) {
      await clearDraft();
      void connect(connection);
      return;
    }

    const session = sessions.find((item) => item.connection.id === connection.id);
    if (!session) return;

    if (connectionTransportChanged(previous, connection)) {
      await closeSession(session.uniqueId);
      void connect(connection);
      return;
    }

    applyConnectionEdit(connection);
  };

  const handleDeleteConnection = async (connection: SSHConnection) => {
    const session = sessions.find((item) => item.connection.id === connection.id);
    if (session) await closeSession(session.uniqueId);
    await remove(connection.id);
  };

  return (
    <>
      <div className="relative flex h-screen w-screen flex-col overflow-hidden border border-border/55 bg-transparent text-foreground">
        <ThemeBackground />
        <TitleBar
          page={page}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onHome={() => setPage('connections')}
          onSwitchSession={focusSession}
          onCloseSession={(id) => void closeSession(id)}
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
                  onClick={dismissError}
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
                onConnect={openConnection}
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

            {/* Kept mounted and hidden rather than unmounted: a session that scrolls off
                screen must not lose its terminal buffer or restart its charts. */}
            <div
              className="absolute inset-0 flex flex-col overflow-hidden"
              style={{ display: page === 'workspace' && sessions.length > 0 ? 'flex' : 'none' }}
            >
              {sessions.map((session) => (
                <Workspace
                  key={session.uniqueId}
                  sessionId={session.uniqueId}
                  connectionId={session.connection.id}
                  serverLabel={session.connection.name}
                  status={session.status}
                  active={page === 'workspace' && session.uniqueId === activeSessionId}
                />
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
          draft={editingConnection?.id ? null : draft}
          onSave={handleSaveConnection}
          onSaveDraft={saveDraft}
          onClearDraft={clearDraft}
          onCancel={() => setEditingConnection(null)}
        />
      </Modal>

      <StartupCover />
      <AppUpdatePrompt />
    </>
  );
}

export default App;
