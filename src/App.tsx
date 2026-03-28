import { useState, useEffect, useRef } from 'react';
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
import { PanelSlotProvider, PanelSlotConsumer } from './components/PanelSlot';
import { Modal } from './components/ui/modal';
import { ConnectionForm } from './components/ConnectionForm';
import { TerminalConnecting } from './components/ConnectingOverlay';
import { ThemeBackground } from './components/ThemeBackground';

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

    // Notify main process to clean up agent runtime state for this session
    (window as any).electron?.agentSessionClose?.(id);
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
      <div className="h-screen w-screen flex flex-col text-foreground overflow-hidden border border-border bg-transparent relative">
        <ThemeBackground />
        <TitleBar
          onSettings={() => setPage('settings')}
          onHome={() => setPage('connections')}
          mode={workspaceMode}
          onModeChange={setWorkspaceMode}
          showModeSwitch={page === 'workspace' && sessions.length > 0}
          showHome={page === 'settings' || (sessions.length > 0 && page === 'workspace')}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={(id) => { setActiveSessionId(id); setPage('workspace'); }}
          onCloseSession={handleCloseSession}
          onNewSession={() => setShowNewConnModal(true)}
        />

        <div className="flex-1 overflow-hidden relative flex flex-col min-h-0">

          {/* ── Connections page: true flex child so the parent always has height ── */}
          {page === 'connections' && (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {connError && (
                <div className="mx-4 mt-3 rounded-lg overflow-hidden ring-1 ring-red-500/20 bg-red-500/[0.06] backdrop-blur-sm animate-in slide-in-from-top-2 duration-300">
                  <div className="flex items-start gap-3 px-4 py-3">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0 mt-0.5">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-red-400 mb-0.5">连接失败</div>
                      <div className="text-[11px] text-red-400/60 leading-relaxed break-all">{connError}</div>
                    </div>
                    <button
                      onClick={() => setConnError(null)}
                      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
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

          {/* ── Settings page ── */}
          {page === 'settings' && (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <Settings onBack={() => setPage(sessions.length > 0 ? 'workspace' : 'connections')} />
            </div>
          )}

          {/* ── Workspace: position:absolute so it never affects parent height.
              display:none removes it from GPU compositor (no Electron bleed-through).
              Sessions stay mounted so xterm state is preserved across page switches. ── */}
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{ display: page === 'workspace' && sessions.length > 0 ? 'flex' : 'none' }}
          >
            <div className="flex-1 relative overflow-hidden" style={{ height: '100%' }}>
              {/* Render ALL sessions to preserve state, but hide inactive ones */}
              {sessions.map(session => (
                <div
                  key={session.uniqueId}
                  className="absolute inset-0"
                  style={{
                    display: session.uniqueId === activeSessionId ? 'flex' : 'none',
                    flexDirection: 'column',
                    height: '100%'
                  }}
                >
                  {/* TerminalSlotProvider wraps both layouts so the single TerminalView
                      instance can be physically moved (via DOM appendChild) to whichever
                      layout is currently active, without ever re-mounting it. */}
                  <TerminalSlotProvider
                    connectionId={session.uniqueId}
                    isVisible={session.uniqueId === activeSessionId}
                  >
                    <PanelSlotProvider
                      connectionId={session.uniqueId}
                      isConnected={session.status === 'connected'}
                      connection={session.connection}
                    >
                      {/* Normal Mode Layout */}
                      <div
                        className="absolute inset-0"
                        style={{ visibility: workspaceMode === 'normal' ? 'visible' : 'hidden', height: '100%' }}
                      >
                        <ResizableLayout
                          leftContent={
                            <div className="h-full flex flex-col bg-card rounded-lg border border-border overflow-hidden">
                              <PanelSlotConsumer panel="files" active={workspaceMode === 'normal'} />
                            </div>
                          }
                          middleContent={
                            <div className="h-full bg-card rounded-lg border border-border flex flex-col overflow-hidden relative">
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
                                <div className="flex-shrink-0 border-t border-border p-1.5 bg-card">
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
                            <div className="h-full bg-card rounded-lg border border-border overflow-hidden">
                              <ErrorBoundary name="RightPanel">
                                <RightPanel connectionId={session.uniqueId} isConnected={session.status === 'connected'} isActive={workspaceMode === 'normal'} />
                              </ErrorBoundary>
                            </div>
                          }
                        />
                      </div>

                      {/* Agent Mode Layout */}
                      <div
                        className="absolute inset-0"
                        style={{ visibility: workspaceMode === 'agent' ? 'visible' : 'hidden', height: '100%' }}
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
                    </PanelSlotProvider>
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
              const stored = await (window as any).electron.storeGet('connections');
              const existing = Array.isArray(stored) ? stored : [];
              await (window as any).electron.storeSet('connections', [...existing, conn]);
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
