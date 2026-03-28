import { useRef, useState, useCallback, useEffect } from 'react';
import { MessageSquare, Activity, FolderOpen, Container, Bot, Sparkles } from 'lucide-react';
import { AIChatPanel, AgentMessage } from './AIChatPanel';
import { AgentSessionSidebar } from './AgentSessionSidebar';
import { AgentSession } from '../shared/types';
import { ErrorBoundary } from './ErrorBoundary';
import { TerminalSlotConsumer } from './TerminalSlot';
import { TerminalConnecting } from './ConnectingOverlay';
import { PanelSlotConsumer, PanelName } from './PanelSlot';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';

interface AgentLayoutProps {
    connectionId: string;
    profileId: string;
    messages: AgentMessage[];
    onMessagesChange: (messages: AgentMessage[]) => void;
    isActive: boolean;
    sessionStatus?: 'connecting' | 'connected' | 'disconnected';
    host?: string;
    username?: string;
}

type SidebarPanel = 'chat' | 'monitor' | 'files' | 'docker';

function generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AgentLayout({
    connectionId,
    profileId,
    messages,
    onMessagesChange,
    isActive,
    sessionStatus,
    host,
    username,
}: AgentLayoutProps) {
    const [chatWidth, setChatWidth] = useState(0.55);
    const layoutRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);
    const [sidebarWidth, setSidebarWidth] = useState(280);
    const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>('chat');
    const { t, language } = useTranslation();

    const [currentSessionId, setCurrentSessionId] = useState<string>(() => generateSessionId());
    const [sidebarRefresh, setSidebarRefresh] = useState(0);
    const hasRestoredRef = useRef(false);
    const currentSessionIdRef = useRef(currentSessionId);

    useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);

    useEffect(() => {
        if (!profileId || hasRestoredRef.current) return;
        hasRestoredRef.current = true;
        (async () => {
            try {
                const list = await (window as any).electron.agentSessionList(profileId);
                if (list && list.length > 0) {
                    const latest = list[0];
                    setCurrentSessionId(latest.id);
                    onMessagesChange(latest.messages as AgentMessage[]);
                }
            } catch { }
        })();
    }, [profileId, onMessagesChange]);

    const stopAgentSession = useCallback((agentSessionId?: string) => {
        if (!agentSessionId) return;
        const eWindow = window as any;
        eWindow.electron?.agentPlanStop?.({ sessionId: agentSessionId });
        eWindow.electron?.agentSessionClose?.(agentSessionId);
    }, []);

    const handleNewSession = useCallback(() => {
        stopAgentSession(currentSessionIdRef.current);
        setCurrentSessionId(generateSessionId());
        onMessagesChange([]);
    }, [onMessagesChange, stopAgentSession]);

    const handleSelectSession = useCallback((session: AgentSession) => {
        if (session.id === currentSessionIdRef.current) return;
        stopAgentSession(currentSessionIdRef.current);
        setCurrentSessionId(session.id);
        onMessagesChange(session.messages as AgentMessage[]);
    }, [onMessagesChange, stopAgentSession]);

    useEffect(() => () => {
        stopAgentSession(currentSessionIdRef.current);
    }, [stopAgentSession]);

    const handleSaveComplete = useCallback(() => {
        setSidebarRefresh(n => n + 1);
    }, []);

    const handleExecuteCommand = useCallback((command: string) => {
        const eWindow = window as any;
        eWindow.electron?.writeTerminal(connectionId, command);
    }, [connectionId]);

    const startResize = () => {
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        let rafId: number | null = null;
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current || !layoutRef.current) return;
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (!layoutRef.current) return;
                const bounds = layoutRef.current.getBoundingClientRect();
                const ratio = (e.clientX - bounds.left) / bounds.width;
                if (ratio > 0.3 && ratio < 0.8) {
                    setChatWidth(ratio);
                }
            });
        };

        const handleMouseUp = () => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            if (isResizing.current) {
                window.dispatchEvent(new Event('resize'));
            }
            isResizing.current = false;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const startSidebarResize = () => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!layoutRef.current) return;
            const bounds = layoutRef.current.getBoundingClientRect();
            setSidebarWidth(Math.max(240, Math.min(420, e.clientX - bounds.left - 52)));
        };

        const handleMouseUp = () => {
            window.dispatchEvent(new Event('resize'));
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

    const navItems: { id: SidebarPanel; icon: any; label: string }[] = [
        { id: 'chat', icon: MessageSquare, label: t('agent.sessionHistory') },
        { id: 'monitor', icon: Activity, label: t('processList.title') },
        { id: 'files', icon: FolderOpen, label: t('fileBrowser.title') },
        { id: 'docker', icon: Container, label: 'Docker' },
    ];

    const workspaceLabel = language === 'zh' ? 'AI 接管工作台' : 'AI Workspace';
    const terminalLabel = language === 'zh' ? 'AI 实时终端' : 'AI Live Terminal';
    const terminalStatusLabel = sessionStatus === 'connected'
        ? (language === 'zh' ? '已连接' : 'Connected')
        : sessionStatus === 'connecting'
            ? (language === 'zh' ? '连接中' : 'Connecting')
            : (language === 'zh' ? '未连接' : 'Disconnected');
    const terminalAssistLabel = language === 'zh'
        ? 'AI 持续观察远端执行'
        : 'AI continuously observes remote execution';

    return (
        <div
            ref={layoutRef}
            className="flex h-full w-full gap-3 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.06),transparent_22%)]"
            style={{ padding: 'var(--panel-gap)' }}
        >
            <div
                className="flex h-full min-w-0 overflow-hidden rounded-[28px] border border-white/6 bg-[linear-gradient(180deg,rgba(22,26,32,0.82),rgba(12,14,18,0.94))] shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl"
                style={{ width: `${chatWidth * 100}%` }}
            >
                <div className="flex w-[52px] shrink-0 flex-col items-center justify-between gap-3 border-r border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] py-3">
                    <div className="flex flex-col items-center gap-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 text-primary shadow-[0_0_20px_rgba(16,185,129,0.12)]">
                            <Bot className="h-4.5 w-4.5" />
                        </div>
                        <div className="h-8 w-px bg-gradient-to-b from-primary/40 via-border/20 to-transparent" />
                    </div>

                    <div className="flex flex-col items-center gap-1.5">
                        {navItems.map(item => (
                            <button
                                key={item.id}
                                onClick={() => setSidebarPanel(item.id)}
                                className={cn(
                                    'relative flex h-10 w-10 items-center justify-center rounded-2xl border transition-all duration-200',
                                    sidebarPanel === item.id
                                        ? 'border-primary/30 bg-primary/14 text-primary shadow-[0_10px_24px_rgba(16,185,129,0.16)]'
                                        : 'border-transparent text-muted-foreground/55 hover:border-white/8 hover:bg-white/4 hover:text-foreground'
                                )}
                                title={item.label}
                            >
                                <item.icon className="h-[18px] w-[18px]" />
                                {sidebarPanel === item.id && (
                                    <div className="absolute -left-[9px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                                )}
                            </button>
                        ))}
                    </div>

                    <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/8 bg-white/3 text-muted-foreground/60">
                        <Sparkles className="h-4 w-4" />
                    </div>
                </div>

                <div style={{ display: sidebarPanel === 'chat' ? 'contents' : 'none' }}>
                    {profileId && (
                        <>
                            <AgentSessionSidebar
                                profileId={profileId}
                                currentSessionId={currentSessionId}
                                onSelectSession={handleSelectSession}
                                onNewSession={handleNewSession}
                                refreshTrigger={sidebarRefresh}
                                style={{ width: sidebarWidth, minWidth: 200, maxWidth: 420 }}
                            />
                            <div
                                className="w-1 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40"
                                onMouseDown={startSidebarResize}
                            />
                        </>
                    )}
                </div>

                {sidebarPanel !== 'chat' && (
                    <>
                        <div
                            className="flex h-full flex-col overflow-hidden border-r border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))]"
                            style={{ width: sidebarWidth, minWidth: 260, maxWidth: 420 }}
                        >
                            <PanelSlotConsumer panel={sidebarPanel as PanelName} active={isActive} />
                        </div>
                        <div
                            className="w-1 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40"
                            onMouseDown={startSidebarResize}
                        />
                    </>
                )}

                <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
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

            <div
                className="relative z-10 mx-0 w-1 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/50"
                onMouseDown={startResize}
            />

            <div
                className="flex h-full min-w-0 flex-col overflow-hidden"
                style={{ width: `${(1 - chatWidth) * 100}%` }}
            >
                <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(13,17,23,0.9),rgba(6,8,11,0.98))] shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur-xl">
                    <div className="border-b border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary/90">
                                    <div className={cn(
                                        'h-2 w-2 rounded-full',
                                        sessionStatus === 'connected'
                                            ? 'bg-green-400'
                                            : sessionStatus === 'connecting'
                                                ? 'bg-yellow-400 animate-pulse'
                                                : 'bg-red-400'
                                    )} />
                                    {terminalLabel}
                                </div>
                                <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-foreground/92">
                                    <span className="truncate">{host || t('agent.terminalView')}</span>
                                    <span className="rounded-full border border-white/8 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/70">
                                        {terminalStatusLabel}
                                    </span>
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground/60">
                                    {username ? `${username}@${host}` : workspaceLabel}
                                </div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                                <span className="rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-[10px] font-medium text-muted-foreground/75">
                                    {terminalAssistLabel}
                                </span>
                                <span className="rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary/85">
                                    {workspaceLabel}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="agent-terminal-shell relative flex-1 overflow-hidden">
                        {isActive && <TerminalSlotConsumer />}
                        {sessionStatus === 'connecting' && host && username && (
                            <TerminalConnecting host={host} username={username} />
                        )}
                    </div>

                    <div className="border-t border-white/8 bg-black/15 px-4 py-2 text-[11px] text-muted-foreground/58">
                        {language === 'zh'
                            ? 'AI 会持续观察远端输出，并把关键进展同步回对话区。'
                            : 'AI keeps watching remote output and reflects key progress back into the chat.'}
                    </div>
                </div>
            </div>
        </div>
    );
}
