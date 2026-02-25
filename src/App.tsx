import { useState, useEffect, useRef } from 'react';
import { FileBrowser } from './components/FileBrowser';
import { SystemMonitor } from './components/SystemMonitor';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TitleBar, WorkspaceMode } from './components/TitleBar';
import { ConnectionManager } from './pages/ConnectionManager';
import { Settings } from './pages/Settings';
import { SSHConnection } from './shared/types';
import { ResizableLayout } from './components/ResizableLayout';
import { useThemeStore } from './store/themeStore';
import { useSettingsStore } from './store/settingsStore';
import { RightPanel } from './components/RightPanel';
import { AICommandInput } from './components/AICommandInput';
import { AgentLayout } from './components/AgentLayout';
import { AgentMessage } from './components/AIChatPanel';
import { TerminalSlotProvider, TerminalSlotConsumer } from './components/TerminalSlot';
import { Modal } from './components/ui/modal';
import { ConnectionForm } from './components/ConnectionForm';
import { TerminalConnecting } from './components/ConnectingOverlay';

interface AppSession {
  uniqueId: string;
  connection: SSHConnection;
  status: 'connecting' | 'connected' | 'disconnected';
}

function App() {
  const [page, setPage] = useState<'connections' | 'workspace' | 'settings'>('connections');
  // Multi-session state
  const [sessions, setSessions] = useState<AppSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { aiEnabled } = useSettingsStore();

  // Global new-connection modal
  const [showNewConnModal, setShowNewConnModal] = useState(false);
  // Inline connection error — replaces alert() which breaks focus in Electron
  const [connError, setConnError] = useState<string | null>(null);

  // Workspace mode: normal or agent
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('normal');

  // Per-session agent chat history keyed by sessionId — useState ensures
  // React properly detects changes and re-renders the AgentLayout with fresh messages.
  const [agentMessages, setAgentMessagesState] = useState<Record<string, AgentMessage[]>>({});

  const getAgentMessages = (sessionId: string): AgentMessage[] => {
    return agentMessages[sessionId] || [];
  };

  const setAgentMessages = (sessionId: string, messages: AgentMessage[]) => {
    setAgentMessagesState(prev => ({ ...prev, [sessionId]: messages }));
  };

  const activeSessionIdx = sessions.findIndex(s => s.uniqueId === activeSessionId);

  useEffect(() => {
    const eWindow = window as any;
    const cleanup = eWindow.electron.onSSHStatus((_: any, { id, status }: any) => {
      setSessions(prev => prev.map(s =>
        s.uniqueId === id ? { ...s, status: status as 'connected' | 'disconnected' } : s
      ));
    });
    return cleanup;
  }, []);

  const initTheme = useThemeStore(state => state.initTheme);
  const { initSettings, uiFontFamily } = useSettingsStore();
  // guard: prevent double auto-connect on HMR hot reloads
  const autoConnectedRef = useRef(false);

  useEffect(() => {
    initTheme();
    initSettings();
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-ui', uiFontFamily);
  }, [uiFontFamily]);

  const handleConnect = async (connection: SSHConnection) => {
    const uniqueId = Date.now().toString();
    const newSession: AppSession = { uniqueId, connection, status: 'connecting' };
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(uniqueId);
    setPage('workspace');
    // @ts-ignore
    window.lastSessionId = uniqueId;

    // Connect in background
    const result = await (window as any).electron.connectSSH({
      connection,
      sessionId: uniqueId,
      profileId: connection.id
    });

    if (result.success) {
      setConnError(null);
      setSessions(prev => prev.map(s =>
        s.uniqueId === uniqueId ? { ...s, status: 'connected' } : s
      ));
      // Remember this connection for next launch
      (window as any).electron.storeSet('lastConnection', JSON.stringify(connection));
    } else {
      // Remove failed session and show inline error (avoid alert() which breaks focus in Electron)
      setSessions(prev => prev.filter(s => s.uniqueId !== uniqueId));
      setPage('connections');
      setActiveSessionId(null);
      setConnError(result.error || 'Connection failed');
    }
  };

  // Auto-reconnect to last session — safe to run here since handleConnect is defined above
  useEffect(() => {
    if (autoConnectedRef.current) return;
    autoConnectedRef.current = true;
    (async () => {
      const last = await (window as any).electron.storeGet('lastConnection');
      if (last) {
        try { handleConnect(JSON.parse(last)); } catch { }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleCloseSession = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // Clean up agent messages for this session
    setAgentMessagesState(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    setSessions(prev => {
      const newSessions = prev.filter(s => s.uniqueId !== id);
      if (newSessions.length === 0) {
        setPage('connections');
        setActiveSessionId(null);
      } else if (activeSessionId === id) {
        // Switch to last session
        setActiveSessionId(newSessions[newSessions.length - 1].uniqueId);
      }
      return newSessions;
    });
  };

  const handleCloseAllSessions = () => {
    if (sessions.length === 0) return;
    setAgentMessagesState({});
    setSessions([]);
    setActiveSessionId(null);
    setPage('connections');
  };

  const activeSession = sessions.find(s => s.uniqueId === activeSessionId);

  console.log('App rendering, page:', page, 'sessions:', sessions.length, 'mode:', workspaceMode);

  return (
    <>
      <div className="h-screen w-screen flex flex-col text-foreground overflow-hidden border border-border bg-transparent">
        <TitleBar
          onSettings={() => setPage('settings')}
          onHome={() => setPage('connections')}
          mode={workspaceMode}
          onModeChange={setWorkspaceMode}
          showModeSwitch={page === 'workspace' && sessions.length > 0}
          showHome={sessions.length > 0 && page === 'workspace'}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={(id) => { setActiveSessionId(id); setPage('workspace'); }}
          onCloseSession={handleCloseSession}
          onNewSession={() => setShowNewConnModal(true)}
        />

        <div className="flex-1 overflow-hidden relative flex flex-col">
          {page === 'connections' && (
            <div className="absolute inset-0 z-50" style={{ backgroundColor: 'hsl(var(--background) / var(--app-opacity, 0.9))' }}>
              {connError && (
                <div className="mx-4 mt-3 px-4 py-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center justify-between">
                  <span>⚠ 连接失败：{connError}</span>
                  <button onClick={() => setConnError(null)} className="ml-4 text-destructive/60 hover:text-destructive text-lg leading-none">×</button>
                </div>
              )}
              <ErrorBoundary name="ConnectionManager">
                <ConnectionManager
                  onConnect={handleConnect}
                  onNavigate={setPage}
                  activeSessions={sessions.length}
                />
              </ErrorBoundary>
            </div>
          )}

          {page === 'settings' && (
            <div className="absolute inset-0 z-50" style={{ backgroundColor: 'hsl(var(--background) / var(--app-opacity, 0.9))' }}>
              <Settings onBack={() => setPage(sessions.length > 0 ? 'workspace' : 'connections')} />
            </div>
          )}

          {/* Workspace — always mounted so terminal state is preserved.
            Settings and Connections pages are absolute overlays at z-50,
            so they appear on top without unmounting the workspace below. */}
          <div
            className="flex-1 relative overflow-hidden flex flex-col"
            style={{ visibility: sessions.length > 0 ? 'visible' : 'hidden' }}
          >
            <div className="flex-1 relative overflow-hidden">
              {/* Render ALL sessions to preserve state, but hide inactive ones */}
              {sessions.map(session => (
                <div
                  key={session.uniqueId}
                  className="absolute inset-0"
                  style={{
                    visibility: session.uniqueId === activeSessionId ? 'visible' : 'hidden',
                    zIndex: session.uniqueId === activeSessionId ? 10 : 0,
                    background: 'hsl(var(--background))'
                  }}
                >
                  {/* TerminalSlotProvider wraps both layouts so the single TerminalView
                      instance can be physically moved (via DOM appendChild) to whichever
                      layout is currently active, without ever re-mounting it. */}
                  <TerminalSlotProvider
                    connectionId={session.uniqueId}
                    isVisible={session.uniqueId === activeSessionId}
                  >
                    {/* Normal Mode Layout */}
                    <div
                      className="absolute inset-0"
                      style={{
                        visibility: workspaceMode === 'normal' ? 'visible' : 'hidden',
                        zIndex: workspaceMode === 'normal' ? 10 : 0
                      }}
                    >
                      <ResizableLayout
                        leftContent={
                          <div className="h-full flex flex-col bg-card/50 rounded-lg border border-border overflow-hidden">
                            <ErrorBoundary name="FileBrowser">
                              <FileBrowser connectionId={session.uniqueId} isConnected={session.status === 'connected'} />
                            </ErrorBoundary>
                          </div>
                        }
                        middleContent={
                          <div className="h-full bg-card/50 rounded-lg border border-border flex flex-col overflow-hidden relative">
                            <div className="flex-1 min-h-0 relative overflow-hidden">
                              {/* TerminalSlotConsumer: placeholder that adopts the stable terminal div */}
                              {workspaceMode === 'normal' && <TerminalSlotConsumer />}
                            </div>
                            {/* Connecting overlay */}
                            {session.status === 'connecting' && (
                              <TerminalConnecting
                                host={session.connection.host}
                                username={session.connection.username || 'root'}
                              />
                            )}
                            {aiEnabled && (
                              <div className="flex-shrink-0 border-t border-border p-1.5 bg-transparent">
                                <AICommandInput
                                  onCommandGenerated={(cmd) => {
                                    const eWindow = window as any;
                                    eWindow.electron?.writeTerminal(session.uniqueId, cmd);
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        }
                        rightContent={
                          <div className="h-full bg-card/50 rounded-lg border border-border overflow-hidden">
                            <ErrorBoundary name="RightPanel">
                              <RightPanel connectionId={session.uniqueId} isConnected={session.status === 'connected'} />
                            </ErrorBoundary>
                          </div>
                        }
                      />
                    </div>

                    {/* Agent Mode Layout */}
                    <div
                      className="absolute inset-0"
                      style={{
                        visibility: workspaceMode === 'agent' ? 'visible' : 'hidden',
                        zIndex: workspaceMode === 'agent' ? 10 : 0
                      }}
                    >
                      <AgentLayout
                        connectionId={session.uniqueId}
                        profileId={session.connection.id || ''}
                        messages={getAgentMessages(session.uniqueId)}
                        onMessagesChange={(msgs) => setAgentMessages(session.uniqueId, msgs)}
                        isActive={workspaceMode === 'agent'}
                        sessionStatus={session.status}
                        host={session.connection.host}
                        username={session.connection.username || 'root'}
                      />
                    </div>
                  </TerminalSlotProvider>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Global new-connection modal — accessible from TitleBar + anywhere */}
      <Modal
        isOpen={showNewConnModal}
        onClose={() => setShowNewConnModal(false)}
        title="新建连接"
      >
        <ConnectionForm
          initialData={{}}
          onSave={async (data: SSHConnection) => {
            setShowNewConnModal(false);
            const username = data.username || 'root';
            const name = data.name || (data.host ? `${username}@${data.host}` : 'New Server');
            const conn: SSHConnection = { ...data, id: data.id || Date.now().toString(), name, username };
            try {
              const stored = await (window as any).electron.storeGet('connections') || [];
              await (window as any).electron.storeSet('connections', [...stored, conn]);
            } catch { }
            await handleConnect(conn);
          }}
          onCancel={() => setShowNewConnModal(false)}
        />
      </Modal>
    </>
  );
}

export default App;
