import { useRef, useState, useCallback, useEffect } from 'react';
import {
    Activity,
    Bot,
    ChevronLeft,
    Container,
    FolderOpen,
    History,
    MessageSquare,
    Plus,
} from 'lucide-react';
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
    const [leftPaneWidth, setLeftPaneWidth] = useState(0.36);
    const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>('chat');
    const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
    const layoutRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);
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
        setSessionDrawerOpen(false);
        onMessagesChange([]);
    }, [onMessagesChange, stopAgentSession]);

    const handleSelectSession = useCallback((session: AgentSession) => {
        if (session.id === currentSessionIdRef.current) return;
        stopAgentSession(currentSessionIdRef.current);
        setCurrentSessionId(session.id);
        setSessionDrawerOpen(false);
        onMessagesChange(session.messages as AgentMessage[]);
    }, [onMessagesChange, stopAgentSession]);

    useEffect(() => () => {
        stopAgentSession(currentSessionIdRef.current);
    }, [stopAgentSession]);

    const handleSaveComplete = useCallback(() => {
        setSidebarRefresh((value) => value + 1);
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
        const handleMouseMove = (event: MouseEvent) => {
            if (!isResizing.current || !layoutRef.current) return;
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (!layoutRef.current) return;
                const bounds = layoutRef.current.getBoundingClientRect();
                const ratio = (event.clientX - bounds.left - 66) / (bounds.width - 66);
                if (ratio > 0.26 && ratio < 0.54) {
                    setLeftPaneWidth(ratio);
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

    useEffect(() => {
        if (sidebarPanel !== 'chat') {
            setSessionDrawerOpen(false);
        }
    }, [sidebarPanel]);

    const navItems: { id: SidebarPanel; icon: any; label: string }[] = [
        { id: 'chat', icon: MessageSquare, label: language === 'zh' ? '对话' : 'Chat' },
        { id: 'monitor', icon: Activity, label: t('processList.title') },
        { id: 'files', icon: FolderOpen, label: t('fileBrowser.title') },
        { id: 'docker', icon: Container, label: 'Docker' },
    ];

    const connected = sessionStatus === 'connected';
    const connecting = sessionStatus === 'connecting';
    const statusLabel = connected
        ? (language === 'zh' ? '已连接' : 'Connected')
        : connecting
            ? (language === 'zh' ? '连接中' : 'Connecting')
            : (language === 'zh' ? '未连接' : 'Disconnected');

    const workspaceTitle = language === 'zh' ? 'Agent 工作区' : 'Agent Workspace';
    const workspaceSubtitle = language === 'zh'
        ? '对话、计划和自动执行都在这里完成'
        : 'Conversation, planning, and execution happen here';
    const stageTitle = language === 'zh' ? '藏青' : 'Zangqing';
    const stageHint = language === 'zh' ? '实时终端与执行结果' : 'Live terminal and execution output';

    return (
        <div
            ref={layoutRef}
            className="flex h-full w-full gap-3 overflow-hidden bg-background"
            style={{
                padding: 'var(--panel-gap)',
                background: 'radial-gradient(circle at top, hsl(var(--background)) 0%, hsl(var(--secondary)) 28%, hsl(var(--muted)) 100%)',
            }}
        >
            <div className="flex h-full w-[56px] shrink-0 flex-col items-center rounded-[24px] border border-border/60 bg-card/80 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                <div className="flex flex-col items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-background text-foreground shadow-sm">
                        <Bot className="h-4.5 w-4.5" />
                    </div>
                    <div className="h-8 w-px bg-gradient-to-b from-border via-border/50 to-transparent" />
                    <div className="flex flex-col items-center gap-1.5">
                        {navItems.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => setSidebarPanel(item.id)}
                                className={cn(
                                    'relative flex h-10 w-10 items-center justify-center rounded-2xl border transition-all duration-200',
                                    sidebarPanel === item.id
                                        ? 'border-border bg-background text-foreground shadow-sm'
                                        : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-background/80 hover:text-foreground'
                                )}
                                title={item.label}
                            >
                                <item.icon className="h-[18px] w-[18px]" />
                                {sidebarPanel === item.id && (
                                    <div className="absolute -left-[8px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-foreground/80" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div
                className="relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden rounded-[30px] border border-border/60 bg-card/82 shadow-[0_24px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl"
                style={{ width: `${leftPaneWidth * 100}%` }}
            >
                <div className="border-b border-border/60 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-1 text-[11px] font-medium text-foreground/72">
                                <Bot className="h-3.5 w-3.5" />
                                {workspaceTitle}
                            </div>
                            <div className="mt-2 text-sm font-semibold text-foreground">{host || workspaceTitle}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{workspaceSubtitle}</div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                            {sidebarPanel === 'chat' && (
                                <>
                                    <button
                                        onClick={() => setSessionDrawerOpen(true)}
                                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/70 bg-background/90 px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent/60"
                                    >
                                        <History className="h-3.5 w-3.5" />
                                        {language === 'zh' ? '会话' : 'Threads'}
                                    </button>
                                    <button
                                        onClick={handleNewSession}
                                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/70 bg-background/90 px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent/60"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        {language === 'zh' ? '新建' : 'New'}
                                    </button>
                                </>
                            )}
                            <span className="rounded-full border border-border/70 bg-background/90 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                                {statusLabel}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="relative min-h-0 flex-1 overflow-hidden">
                    {sidebarPanel === 'chat' ? (
                        <>
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

                            <div
                                className={cn(
                                    'absolute inset-0 z-20 transition-all duration-300',
                                    sessionDrawerOpen ? 'pointer-events-auto bg-black/16 opacity-100' : 'pointer-events-none opacity-0'
                                )}
                                onClick={() => setSessionDrawerOpen(false)}
                            />

                            <div
                                className={cn(
                                    'absolute inset-y-0 left-0 z-30 w-[min(360px,100%)] shadow-[0_24px_52px_rgba(15,23,42,0.14)] transition-transform duration-300',
                                    'border-r border-border/60 bg-card/96',
                                    sessionDrawerOpen ? 'translate-x-0' : '-translate-x-full'
                                )}
                            >
                                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                                    <div>
                                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                                            {language === 'zh' ? '会话管理' : 'Thread Manager'}
                                        </div>
                                        <div className="mt-1 text-sm font-semibold text-foreground">
                                            {language === 'zh' ? '继续之前的任务' : 'Continue Previous Work'}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setSessionDrawerOpen(false)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-accent/60 hover:text-foreground"
                                        title={language === 'zh' ? '收起' : 'Close'}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </button>
                                </div>
                                {profileId && (
                                    <AgentSessionSidebar
                                        profileId={profileId}
                                        currentSessionId={currentSessionId}
                                        onSelectSession={handleSelectSession}
                                        onNewSession={handleNewSession}
                                        refreshTrigger={sidebarRefresh}
                                        showHeader={false}
                                    />
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="h-full overflow-hidden">
                            <PanelSlotConsumer panel={sidebarPanel as PanelName} active={isActive} />
                        </div>
                    )}
                </div>
            </div>

            <div
                className="relative z-10 mx-0 w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border/60"
                onMouseDown={startResize}
            />

            <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-border/60 bg-card/88 shadow-[0_24px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl">
                <div className="border-b border-border/60 px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-1 text-[11px] font-medium text-foreground/72">
                                <div
                                    className={cn(
                                        'h-2 w-2 rounded-full',
                                        connected ? 'bg-emerald-500' : connecting ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'
                                    )}
                                />
                                {stageTitle}
                            </div>
                            <div className="mt-2 text-sm font-semibold text-foreground">{host || t('agent.terminalView')}</div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                            <span className="rounded-full border border-border/70 bg-background/90 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                                {statusLabel}
                            </span>
                            <span className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[10px] font-medium text-foreground/75">
                                {username ? `${username}@${host}` : stageHint}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="min-h-0 flex-1 p-4">
                    <div className="flex h-full flex-col overflow-hidden rounded-[26px] border border-border/60 bg-background/82 shadow-[inset_0_1px_0_hsl(var(--background)/0.28)]">
                        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1.5">
                                    <span className="h-2.5 w-2.5 rounded-full bg-rose-300/80" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-amber-300/85" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/85" />
                                </div>
                                <span className="text-xs font-medium text-foreground/72">
                                    {language === 'zh' ? '执行画布' : 'Execution Canvas'}
                                </span>
                            </div>
                            <span className="text-[11px] text-muted-foreground">{stageHint}</span>
                        </div>

                        <div className="agent-terminal-shell flex-1 overflow-hidden bg-background/82">
                            {isActive && <TerminalSlotConsumer />}
                            {sessionStatus === 'connecting' && host && username && (
                                <TerminalConnecting host={host} username={username} />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
