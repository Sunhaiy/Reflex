import { useState, useEffect } from 'react';
import { TerminalView } from './components/TerminalView';
import { FileBrowser } from './components/FileBrowser';
import { SystemMonitor } from './components/SystemMonitor';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TitleBar } from './components/TitleBar';
import { ConnectionManager } from './pages/ConnectionManager';
import { Settings } from './pages/Settings';
import { SSHConnection } from './shared/types';
import { SessionTabs, Session } from './components/SessionTabs';
import { ResizableLayout } from './components/ResizableLayout';
import { useThemeStore } from './store/themeStore';
import { useSettingsStore } from './store/settingsStore';
import { RightPanel } from './components/RightPanel';
import { AICommandInput } from './components/AICommandInput';

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

  const activeSessionIdx = sessions.findIndex(s => s.uniqueId === activeSessionId);

  useEffect(() => {
    const cleanup = window.electron.onSSHStatus((_, { id, status }) => {
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
    document.body.style.fontFamily = uiFontFamily;
  }, [uiFontFamily]);

  const handleConnect = async (connection: SSHConnection) => {
    // Create new session
    const uniqueId = Date.now().toString();
    const result = await window.electron.connectSSH({ ...connection, id: uniqueId }); // Use unique ID for this session

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

    // Disconnect SSH
    // await window.electron.disconnectSSH(id); // Assuming this API exists, otherwise connection drops naturally or we need to add it

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
      setSessions([]);
      setActiveSessionId(null);
      setPage('connections');
    }
  };

  const activeSession = sessions.find(s => s.uniqueId === activeSessionId);

  console.log('App rendering, page:', page, 'sessions:', sessions.length);

  return (
    <div className="h-screen w-screen flex flex-col text-foreground overflow-hidden border border-border bg-background">
      <TitleBar />

      <div className="flex-1 overflow-hidden relative flex flex-col">
        {page === 'connections' && (
          <div className="absolute inset-0 z-50 bg-background">
            <ErrorBoundary name="ConnectionManager">
              <ConnectionManager
                onConnect={handleConnect}
                onNavigate={setPage}
              />
            </ErrorBoundary>
          </div>
        )}

        {page === 'settings' && (
          <div className="absolute inset-0 z-50 bg-background">
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
                  className="absolute inset-0 z-0 bg-background"
                  style={{
                    visibility: session.uniqueId === activeSessionId ? 'visible' : 'hidden',
                    zIndex: session.uniqueId === activeSessionId ? 10 : 0
                  }}
                >
                  <ResizableLayout
                    leftContent={
                      <div className="h-full flex flex-col bg-card/40 border-r border-border backdrop-blur-sm">
                        <ErrorBoundary name="FileBrowser">
                          <FileBrowser connectionId={session.uniqueId} />
                        </ErrorBoundary>
                      </div>
                    }
                    middleContent={
                      <div className="h-full bg-background/50 backdrop-blur-sm flex flex-col overflow-hidden">
                        <div className="flex-1 min-h-0 relative overflow-hidden">
                          <ErrorBoundary name="Terminal">
                            <TerminalView connectionId={session.uniqueId} />
                          </ErrorBoundary>
                        </div>
                        {aiEnabled && (
                          <div className="flex-shrink-0 border-t border-border p-2 bg-background/80">
                            <AICommandInput
                              onCommandGenerated={(cmd) => {
                                window.electron?.writeTerminal(session.uniqueId, cmd);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    }
                    rightContent={
                      <div className="h-full bg-card/40 border-l border-border backdrop-blur-sm">
                        <ErrorBoundary name="RightPanel">
                          <RightPanel connectionId={session.uniqueId} />
                        </ErrorBoundary>
                      </div>
                    }
                  />
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
