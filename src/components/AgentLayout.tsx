// AgentLayout - Two-panel layout for Agent mode
// Uses TerminalSlotConsumer to display the shared terminal instance
import { useRef, useState, useCallback } from 'react';
import { AIChatPanel, AgentMessage } from './AIChatPanel';
import { AgentSessionSidebar } from './AgentSessionSidebar';
import { AgentSession } from '../shared/types';
import { ErrorBoundary } from './ErrorBoundary';
import { TerminalSlotConsumer } from './TerminalSlot';
import { TerminalConnecting } from './ConnectingOverlay';
import { useTranslation } from '../hooks/useTranslation';

interface AgentLayoutProps {
    connectionId: string;
    profileId: string;     // SSHConnection.id — for session binding
    messages: AgentMessage[];
    onMessagesChange: (messages: AgentMessage[]) => void;
    isActive: boolean;
    sessionStatus?: 'connecting' | 'connected' | 'disconnected';
    host?: string;
    username?: string;
}

function generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AgentLayout({ connectionId, profileId, messages, onMessagesChange, isActive, sessionStatus, host, username }: AgentLayoutProps) {
    const [chatWidth, setChatWidth] = useState(0.55); // 55% for chat
    const layoutRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);
    const [sidebarWidth, setSidebarWidth] = useState(180); // px, 140-320
    const { t } = useTranslation();

    // Session management
    const [currentSessionId, setCurrentSessionId] = useState<string>(() => generateSessionId());
    const [sidebarRefresh, setSidebarRefresh] = useState(0);

    const handleNewSession = useCallback(() => {
        setCurrentSessionId(generateSessionId());
        onMessagesChange([]); // clear chat
    }, [onMessagesChange]);

    const handleSelectSession = useCallback((session: AgentSession) => {
        setCurrentSessionId(session.id);
        onMessagesChange(session.messages as AgentMessage[]);
    }, [onMessagesChange]);

    const handleSaveComplete = useCallback(() => {
        setSidebarRefresh(n => n + 1);
    }, []);

    const handleExecuteCommand = (command: string) => {
        const eWindow = window as any;
        eWindow.electron?.writeTerminal(connectionId, command);
    };

    // Drag-to-resize handlers
    const startResize = () => {
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current || !layoutRef.current) return;
            const bounds = layoutRef.current.getBoundingClientRect();
            const ratio = (e.clientX - bounds.left) / bounds.width;
            if (ratio > 0.3 && ratio < 0.8) setChatWidth(ratio);
        };
        const handleMouseUp = () => {
            if (isResizing.current) window.dispatchEvent(new Event('resize'));
            isResizing.current = false;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    // Sidebar drag-resize
    const startSidebarResize = () => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!layoutRef.current) return;
            const bounds = layoutRef.current.getBoundingClientRect();
            setSidebarWidth(Math.max(140, Math.min(320, e.clientX - bounds.left)));
        };
        const handleMouseUp = () => {
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <div ref={layoutRef} className="flex h-full w-full overflow-hidden" style={{ padding: 'var(--panel-gap)' }}>
            {/* Left: Session Sidebar + Chat Panel */}
            <div
                className="h-full flex min-w-0 overflow-hidden"
                style={{ width: `${chatWidth * 100}%` }}
            >
                {/* Session History Sidebar */}
                {profileId && (
                    <>
                        <AgentSessionSidebar
                            profileId={profileId}
                            currentSessionId={currentSessionId}
                            onSelectSession={handleSelectSession}
                            onNewSession={handleNewSession}
                            refreshTrigger={sidebarRefresh}
                            style={{ width: sidebarWidth, minWidth: 140, maxWidth: 320 }}
                        />
                        {/* Sidebar resize handle */}
                        <div
                            className="w-1 cursor-col-resize hover:bg-primary/40 bg-border/40 transition-colors flex-shrink-0"
                            onMouseDown={startSidebarResize}
                        />
                    </>
                )}

                {/* AI Chat */}
                <div className="flex-1 min-w-0 h-full bg-card/50 rounded-r-lg border border-border overflow-hidden flex flex-col">
                    <ErrorBoundary name="AIChatPanel">
                        <AIChatPanel
                            connectionId={connectionId}
                            profileId={profileId}
                            host={host || ''}
                            sessionId={currentSessionId}
                            messages={messages}
                            onMessagesChange={onMessagesChange}
                            onExecuteCommand={handleExecuteCommand}
                            onSaveComplete={handleSaveComplete}
                        />
                    </ErrorBoundary>
                </div>
            </div>

            {/* Resizer */}
            <div
                className="w-1 cursor-col-resize hover:bg-primary/50 transition-colors bg-transparent relative z-10 flex-shrink-0 mx-0"
                onMouseDown={startResize}
            />

            {/* Right: Terminal Observation - uses TerminalSlotConsumer to host the shared terminal */}
            <div
                className="h-full flex flex-col min-w-0 overflow-hidden"
                style={{ width: `${(1 - chatWidth) * 100}%` }}
            >
                <div className="h-full bg-card/50 rounded-lg border border-border overflow-hidden flex flex-col">
                    {/* Terminal Header */}
                    <div className="flex items-center px-3 py-1.5 border-b border-border bg-muted/40 text-xs text-muted-foreground">
                        <div className={`w-2 h-2 rounded-full mr-2 ${sessionStatus === 'connected' ? 'bg-green-500' : sessionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-400'}`} />
                        {t('agent.terminalView')}
                    </div>
                    <div className="flex-1 min-h-0 relative overflow-hidden">
                        {isActive && <TerminalSlotConsumer />}
                        {sessionStatus === 'connecting' && host && username && (
                            <TerminalConnecting host={host} username={username} />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
