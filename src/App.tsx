import { useState, useEffect, useRef } from 'react';
import { TerminalView } from './components/TerminalView';
import { FileBrowser } from './components/FileBrowser';
import { SystemMonitor } from './components/SystemMonitor';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TitleBar, WorkspaceMode } from './components/TitleBar';
import { ConnectionManager } from './pages/ConnectionManager';
import { Settings } from './pages/Settings';
import { SSHConnection } from './shared/types';
import { SessionTabs, Session } from './components/SessionTabs';
import { ResizableLayout } from './components/ResizableLayout';
import { useThemeStore } from './store/themeStore';
import { useSettingsStore } from './store/settingsStore';
import { RightPanel } from './components/RightPanel';
import { AICommandInput } from './components/AICommandInput';
import { AgentLayout } from './components/AgentLayout';
import { AgentMessage } from './components/AIChatPanel';

interface AppSession {
  uniqueId: string;
  connection: SSHConnection;
  status: 'connected' | 'disconnected';
}

function App() {
  const [page, setPage] = useState<'connections' | 'workspace' | 'settings'>('connections');
  // Multi-session state
  const [sessions, setSessions] = useState<AppSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { aiEnabled } = useSettingsStore();

  // Workspace mode: normal or agent
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('normal');

  // Per-session agent chat history (persisted across mode switches)
  const agentMessagesRef = useRef<Map<string, AgentMessage[]>>(new Map());
  const [agentMessagesVersion, setAgentMessagesVersion] = useState(0);

  const getAgentMessages = (sessionId: string): AgentMessage[] => {
    return agentMessagesRef.current.get(sessionId) || [];
  };

  const setAgentMessages = (sessionId: string, messages: AgentMessage[]) => {
    agentMessagesRef.current.set(sessionId, messages);
    setAgentMessagesVersion(v => v + 1); // trigger re-render
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

  useEffect(() => {
    initTheme();
    initSettings();
  }, [initTheme, initSettings]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-ui', uiFontFamily);
  }, [uiFontFamily]);

  const handleConnect = async (connection: SSHConnection) => {
    // Create new session
    const uniqueId = Date.now().toString();
    const result = await (window as any).electron.connectSSH({
      connection,
      sessionId: uniqueId,
      profileId: connection.id
    });
    // @ts-ignore
    window.lastSessionId = uniqueId; // For debugging if needed

    if (result.success) {
      const newSession: AppSession = { uniqueId, connection, status: 'connected' };
      setSessions(prev => [...prev, newSession]);
      setActiveSessionId(uniqueId);
      setPage('workspace');
    } else {
      alert('Connection failed: ' + result.error);
    }
  };

  const handleCloseSession = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // Clean up agent messages for this session
    agentMessagesRef.current.delete(id);

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
    if (confirm('Are you sure you want to close all active sessions?')) {
      agentMessagesRef.current.clear();
      setSessions([]);
      setActiveSessionId(null);
      setPage('connections');
    }
  };

  const activeSession = sessions.find(s => s.uniqueId === activeSessionId);

  console.log('App rendering, page:', page, 'sessions:', sessions.length, 'mode:', workspaceMode);

  return (
    <div className="h-screen w-screen flex flex-col text-foreground overflow-hidden border border-border bg-transparent">
      <TitleBar
        onSettings={() => setPage('settings')}
        mode={workspaceMode}
        onModeChange={setWorkspaceMode}
        showModeSwitch={page === 'workspace' && sessions.length > 0}
      />

      <div className="flex-1 overflow-hidden relative flex flex-col">
        {page === 'connections' && (
          <div className="absolute inset-0 z-50" style={{ backgroundColor: 'hsl(var(--background) / var(--app-opacity, 0.9))' }}>
            <ErrorBoundary name="ConnectionManager">
              <ConnectionManager
                onConnect={handleConnect}
                onNavigate={setPage}
              />
            </ErrorBoundary>
          </div>
        )}

        {page === 'settings' && (
          <div className="absolute inset-0 z-50" style={{ backgroundColor: 'hsl(var(--background) / var(--app-opacity, 0.9))' }}>
            <Settings onBack={() => setPage(sessions.length > 0 ? 'workspace' : 'connections')} />
          </div>
        )}

        {page === 'workspace' && (
          <>
            <SessionTabs
              sessions={sessions}
              activeId={activeSessionId}
              onSwitch={setActiveSessionId}
              onClose={handleCloseSession}
              onNew={() => setPage('connections')}
              onCloseAll={handleCloseAllSessions}
            />

            <div className="flex-1 relative overflow-hidden">
              {/* Render ALL sessions to preserve state, but hide inactive ones */}
              {sessions.map(session => (
                <div
                  key={session.uniqueId}
                  className="absolute inset-0 z-0 bg-transparent"
                  style={{
                    visibility: session.uniqueId === activeSessionId ? 'visible' : 'hidden',
                    zIndex: session.uniqueId === activeSessionId ? 10 : 0
                  }}
                >
                  {/* Normal Mode Layout - always mounted, visibility toggled */}
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
                            <FileBrowser connectionId={session.uniqueId} />
                          </ErrorBoundary>
                        </div>
                      }
                      middleContent={
                        <div className="h-full bg-card/50 rounded-lg border border-border flex flex-col overflow-hidden">
                          <div className="flex-1 min-h-0 relative overflow-hidden">
                            <ErrorBoundary name="Terminal">
                              <TerminalView connectionId={session.uniqueId} />
                            </ErrorBoundary>
                          </div>
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
                            <RightPanel connectionId={session.uniqueId} />
                          </ErrorBoundary>
                        </div>
                      }
                    />
                  </div>

                  {/* Agent Mode Layout - always mounted, visibility toggled */}
                  <div
                    className="absolute inset-0"
                    style={{
                      visibility: workspaceMode === 'agent' ? 'visible' : 'hidden',
                      zIndex: workspaceMode === 'agent' ? 10 : 0
                    }}
                  >
                    <AgentLayout
                      connectionId={session.uniqueId}
                      messages={getAgentMessages(session.uniqueId)}
                      onMessagesChange={(msgs) => setAgentMessages(session.uniqueId, msgs)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
