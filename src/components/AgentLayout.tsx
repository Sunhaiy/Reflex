import { useRef, useState, useCallback, useEffect } from 'react';
import {
    Activity,
    Bot,
    ChevronLeft,
    ChevronDown,
    Container,
    FolderOpen,
    History,
    MessageSquare,
    Monitor,
    Plus,
} from 'lucide-react';
import { AIChatPanel, AgentMessage } from './AIChatPanel';
import { AgentSessionSidebar } from './AgentSessionSidebar';
import { AgentPlanPhase, AgentSession, AgentSessionRuntime } from '../shared/types';
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

function normalizeRestoredPlanPhase(phase?: AgentPlanPhase): AgentPlanPhase {
    if (!phase) return 'idle';
    if (phase === 'executing' || phase === 'generating') {
        return 'stopped';
    }
    return phase;
}

function restoreRuntime(runtime?: AgentSessionRuntime | null): AgentSessionRuntime | null {
    if (!runtime) return null;
    return {
        ...runtime,
        planStatus: normalizeRestoredPlanPhase(runtime.planStatus),
    };
}

function looksLikeMojibake(text?: string | null) {
    if (!text) return false;
    return /(妫€|鏌|鍐|鎵ц|杩滅|绋|缁|閮|鍙|鐢诲竷|瀵硅瘽)/.test(text);
}

function sanitizeRuntimeText(text?: string | null, fallback = '') {
    if (!text) return fallback;
    return looksLikeMojibake(text) ? fallback : text;
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
    const [leftPaneWidth, setLeftPaneWidth] = useState(0.38);
    const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>('chat');
    const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
    const [progressPopoverOpen, setProgressPopoverOpen] = useState(false);
    const [currentSessionId, setCurrentSessionId] = useState<string>(() => generateSessionId());
    const [currentRuntime, setCurrentRuntime] = useState<AgentSessionRuntime | null>(null);
    const [sidebarRefresh, setSidebarRefresh] = useState(0);
    const layoutRef = useRef<HTMLDivElement>(null);
    const progressPopoverRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);
    const restoredProfileIdRef = useRef<string | null>(null);
    const currentSessionIdRef = useRef(currentSessionId);
    const { t, language } = useTranslation();

    useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);

    useEffect(() => {
        if (!profileId || restoredProfileIdRef.current === profileId) return;
        restoredProfileIdRef.current = profileId;
        (async () => {
            try {
                const list = await (window as any).electron.agentSessionList(profileId);
                if (list && list.length > 0) {
                    const latest = list[0] as AgentSession;
                    setCurrentSessionId(latest.id);
                    setCurrentRuntime(restoreRuntime(latest.runtime));
                    onMessagesChange(latest.messages as AgentMessage[]);
                    return;
                }
                setCurrentSessionId(generateSessionId());
                setCurrentRuntime(null);
                onMessagesChange([]);
            } catch {
                setCurrentSessionId(generateSessionId());
                setCurrentRuntime(null);
                onMessagesChange([]);
            }
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
        setCurrentRuntime(null);
        setSessionDrawerOpen(false);
        onMessagesChange([]);
    }, [onMessagesChange, stopAgentSession]);

    const handleSelectSession = useCallback((session: AgentSession) => {
        if (session.id === currentSessionIdRef.current) return;
        stopAgentSession(currentSessionIdRef.current);
        setCurrentSessionId(session.id);
        setCurrentRuntime(restoreRuntime(session.runtime));
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
                const ratio = (event.clientX - bounds.left - 56) / (bounds.width - 56);
                if (ratio > 0.3 && ratio < 0.58) {
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

    useEffect(() => {
        if (!progressPopoverOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (!progressPopoverRef.current?.contains(event.target as Node)) {
                setProgressPopoverOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [progressPopoverOpen]);

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

    const planSteps = currentRuntime?.planState?.plan || [];
    const completedSteps = planSteps.filter((step) => step.status === 'completed' || step.status === 'skipped').length;
    const activeStep = planSteps.find((step) => step.status === 'in_progress' || step.status === 'waiting_approval');
    const phaseLabel = currentRuntime?.planStatus === 'executing'
        ? (activeStep?.description || (language === 'zh' ? '正在处理任务' : 'Working on task'))
        : currentRuntime?.planStatus === 'generating'
            ? (language === 'zh' ? '正在生成执行计划' : 'Building plan')
            : currentRuntime?.planStatus === 'paused'
                ? (language === 'zh' ? '等待继续' : 'Waiting to continue')
                : currentRuntime?.planStatus === 'waiting_approval'
                    ? (language === 'zh' ? '等待批准高风险操作' : 'Waiting for approval')
                    : currentRuntime?.planStatus === 'done'
                        ? (language === 'zh' ? '任务已完成' : 'Task completed')
                        : currentRuntime?.planStatus === 'stopped'
                            ? (language === 'zh' ? '已停止，可继续接着做' : 'Stopped, ready to continue')
                            : (language === 'zh' ? '等待新目标' : 'Waiting for next goal');
    const statusLabelShort = currentRuntime?.planStatus === 'executing'
        ? (language === 'zh' ? '执行中' : 'Running')
        : currentRuntime?.planStatus === 'generating'
            ? (language === 'zh' ? '规划中' : 'Planning')
            : currentRuntime?.planStatus === 'paused'
                ? (language === 'zh' ? '等待继续' : 'Waiting to continue')
                : currentRuntime?.planStatus === 'waiting_approval'
                    ? (language === 'zh' ? '等待批准' : 'Waiting for approval')
                    : currentRuntime?.planStatus === 'done'
                        ? (language === 'zh' ? '任务已完成' : 'Completed')
                        : currentRuntime?.planStatus === 'stopped'
                            ? (language === 'zh' ? '已停止，可继续接着做' : 'Stopped, ready to continue')
                            : (language === 'zh' ? '等待新目标' : 'Waiting for next goal');
    const progressLabel = planSteps.length > 0
        ? (language === 'zh' ? `当前进度 ${completedSteps}/${planSteps.length}` : `Progress ${completedSteps}/${planSteps.length}`)
        : (language === 'zh' ? '等待创建计划' : 'Plan not started');
    const runtimeTask = currentRuntime?.activeTaskRun || null;
    const runtimeRoute = runtimeTask?.activeHypothesisId
        ? runtimeTask.hypotheses.find((item) => item.id === runtimeTask.activeHypothesisId)?.kind || runtimeTask.activeHypothesisId
        : null;
    const runtimeFailure = runtimeTask?.failureHistory?.[runtimeTask.failureHistory.length - 1];
    const runtimeContextWindow = currentRuntime?.contextWindow || null;
    const runtimeTodos = runtimeTask?.taskTodos || currentRuntime?.taskTodos || [];
    const memoryFiles = currentRuntime?.memoryFiles || [];
    const progressHint = language === 'zh' ? '点击查看任务详情' : 'Click for task details';
    return (
        <div
            ref={layoutRef}
            className="flex h-full w-full gap-3 overflow-hidden bg-background"
            style={{ padding: 'var(--panel-gap)' }}
        >
            <div className="flex h-full w-14 shrink-0 flex-col items-center border-r border-border bg-card py-3">
                <div className="flex flex-col items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-foreground">
                        <Bot className="h-4.5 w-4.5" />
                    </div>
                    <div className="h-8 w-px bg-border" />
                    <div className="flex flex-col items-center gap-1.5">
                        {navItems.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => setSidebarPanel(item.id)}
                                className={cn(
                                    'relative flex h-10 w-10 items-center justify-center rounded-lg border text-muted-foreground transition-colors',
                                    sidebarPanel === item.id
                                        ? 'border-border bg-background text-foreground'
                                        : 'border-transparent hover:border-border hover:bg-background hover:text-foreground'
                                )}
                                title={item.label}
                            >
                                <item.icon className="h-[18px] w-[18px]" />
                                {sidebarPanel === item.id && (
                                    <div className="absolute -left-[8px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div
                className="relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
                style={{ width: `${leftPaneWidth * 100}%` }}
            >
                <div className="border-b border-border px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground">
                                <Bot className="h-3.5 w-3.5" />
                                {workspaceTitle}
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                            {sidebarPanel === 'chat' && (
                                <>
                                    <button
                                        onClick={() => setSessionDrawerOpen(true)}
                                        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors hover:bg-accent"
                                    >
                                        <History className="h-3.5 w-3.5" />
                                        {language === 'zh' ? '会话' : 'Threads'}
                                    </button>
                                    <button
                                        onClick={handleNewSession}
                                        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors hover:bg-accent"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        {language === 'zh' ? '新建' : 'New'}
                                    </button>
                                </>
                            )}
                            <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
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
                                    restoredRuntime={currentRuntime}
                                    messages={messages}
                                    onMessagesChange={onMessagesChange}
                                    onExecuteCommand={handleExecuteCommand}
                                    onSaveComplete={handleSaveComplete}
                                    onRuntimeChange={setCurrentRuntime}
                                />
                            </ErrorBoundary>

                            <div
                                className={cn(
                                    'absolute inset-0 z-20 transition-opacity duration-200',
                                    sessionDrawerOpen ? 'pointer-events-auto bg-background/48 opacity-100' : 'pointer-events-none opacity-0'
                                )}
                                onClick={() => setSessionDrawerOpen(false)}
                            />

                            <div
                                className={cn(
                                    'absolute inset-y-0 left-0 z-30 w-[320px] max-w-full border-r border-border bg-card transition-transform duration-200',
                                    sessionDrawerOpen ? 'translate-x-0' : '-translate-x-full'
                                )}
                            >
                                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                                    <div>
                                        <div className="text-xs font-medium text-muted-foreground">
                                            {language === 'zh' ? '会话管理' : 'Thread Manager'}
                                        </div>
                                        <div className="mt-1 text-sm font-semibold text-foreground">
                                            {language === 'zh' ? '继续之前的任务' : 'Continue previous work'}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setSessionDrawerOpen(false)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                        title={language === 'zh' ? '关闭' : 'Close'}
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
                className="relative z-10 mx-0 w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border"
                onMouseDown={startResize}
            />

            <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
                <div className="border-b border-border px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground">
                                    <Monitor className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-foreground">{stageTitle}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                        <div className="relative" ref={progressPopoverRef}>
                                            <button
                                                type="button"
                                                onClick={() => setProgressPopoverOpen((value) => !value)}
                                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"
                                                title={progressHint}
                                            >
                                                <span
                                                    className={cn(
                                                        'h-2 w-2 rounded-full',
                                                        connected ? 'bg-emerald-500' : connecting ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'
                                                    )}
                                                />
                                                <span>{progressLabel}</span>
                                                <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', progressPopoverOpen && 'rotate-180')} />
                                            </button>
                                            {progressPopoverOpen && (
                                                <div className="absolute left-0 top-full z-30 mt-2 w-[340px] max-w-[min(340px,calc(100vw-120px))] rounded-lg border border-border bg-card p-3 shadow-lg">
                                                    <div className="space-y-3 text-xs">
                                                        {runtimeContextWindow && (
                                                            <div className="rounded-md border border-border bg-background px-2.5 py-2">
                                                                <div className="mb-1 text-[10px] text-muted-foreground">
                                                                    {language === 'zh' ? '背景信息窗口' : 'Context window'}
                                                                </div>
                                                                <div className="flex flex-wrap gap-1.5 text-foreground/82">
                                                                    <span>{language === 'zh' ? `已用 ${runtimeContextWindow.promptTokens}/${runtimeContextWindow.limitTokens}` : `Used ${runtimeContextWindow.promptTokens}/${runtimeContextWindow.limitTokens}`}</span>
                                                                    <span>{language === 'zh' ? `${runtimeContextWindow.percentUsed}% 已用` : `${runtimeContextWindow.percentUsed}% used`}</span>
                                                                    <span>{language === 'zh' ? `自动压缩 x${runtimeContextWindow.compressionCount}` : `Auto-compressed x${runtimeContextWindow.compressionCount}`}</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="space-y-1">
                                                            <div className="font-medium text-foreground">{language === 'zh' ? '任务详情' : 'Task details'}</div>
                                                            <div className="text-muted-foreground">
                                                                {sanitizeRuntimeText(
                                                                    phaseLabel,
                                                                    language === 'zh' ? '任务正在运行' : 'Task is running',
                                                                )}
                                                            </div>
                                                        </div>
                                                        {runtimeTask ? (
                                                            <>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    <span className="rounded-md border border-border bg-background px-2 py-1">
                                                                        {language === 'zh' ? `阶段 ${runtimeTask.phase}` : `Phase ${runtimeTask.phase}`}
                                                                    </span>
                                                                    {runtimeRoute && (
                                                                        <span className="rounded-md border border-border bg-background px-2 py-1">
                                                                            {language === 'zh' ? `路线 ${runtimeRoute}` : `Route ${runtimeRoute}`}
                                                                        </span>
                                                                    )}
                                                                    <span className="rounded-md border border-border bg-background px-2 py-1">
                                                                        {language === 'zh' ? `修复 ${runtimeTask.attemptCount}/5` : `Repairs ${runtimeTask.attemptCount}/5`}
                                                                    </span>
                                                                    {memoryFiles.length > 0 && (
                                                                        <span className="rounded-md border border-border bg-background px-2 py-1">
                                                                            {language === 'zh' ? `记忆文件 ${memoryFiles.length}` : `Memory ${memoryFiles.length}`}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {runtimeTodos.length > 0 && (
                                                                    <div className="rounded-md border border-border bg-background px-2.5 py-2">
                                                                        <div className="mb-1 text-[10px] text-muted-foreground">{language === 'zh' ? '任务清单' : 'Task list'}</div>
                                                                        <div className="space-y-1">
                                                                            {runtimeTodos.map((todo) => (
                                                                                <div key={todo.id} className="flex items-start gap-2 text-foreground/82">
                                                                                    <span className="mt-0.5 text-[10px] text-muted-foreground">
                                                                                        {todo.status === 'completed' ? '●' : todo.status === 'in_progress' ? '◉' : '○'}
                                                                                    </span>
                                                                                    <span className="leading-relaxed">{todo.content}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {runtimeTask.childRuns?.length > 0 && (
                                                                    <div className="rounded-md border border-border bg-background px-2.5 py-2">
                                                                        <div className="mb-1 text-[10px] text-muted-foreground">{language === 'zh' ? '子任务' : 'Child tasks'}</div>
                                                                        <div className="space-y-1">
                                                                            {runtimeTask.childRuns.slice(-4).map((child) => (
                                                                                <div key={child.id} className="space-y-0.5 text-foreground/82">
                                                                                    <div className="flex items-center justify-between gap-2">
                                                                                        <span className="font-medium text-foreground">{child.title}</span>
                                                                                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{child.status}</span>
                                                                                    </div>
                                                                                    <div className="leading-relaxed text-muted-foreground">
                                                                                        {sanitizeRuntimeText(child.summary || child.lastAction || child.goal)}
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {runtimeTask.currentAction && (
                                                                    <div className="rounded-md border border-border bg-background px-2.5 py-2">
                                                                        <div className="mb-1 text-[10px] text-muted-foreground">{language === 'zh' ? '当前动作' : 'Action'}</div>
                                                                        <div className="leading-relaxed text-foreground/85">
                                                                            {sanitizeRuntimeText(
                                                                                runtimeTask.currentAction,
                                                                                language === 'zh' ? '正在执行当前动作' : 'Executing the current action',
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {runtimeTask.checkpoint.knownFacts.length > 0 && (
                                                                    <div className="rounded-md border border-border bg-background px-2.5 py-2">
                                                                        <div className="mb-1 text-[10px] text-muted-foreground">{language === 'zh' ? '当前判断' : 'Working notes'}</div>
                                                                        <div className="space-y-1">
                                                                            {runtimeTask.checkpoint.knownFacts
                                                                                .map((fact) => sanitizeRuntimeText(fact))
                                                                                .filter(Boolean)
                                                                                .slice(-4)
                                                                                .map((fact) => (
                                                                                <div key={fact} className="leading-relaxed text-foreground/82">{fact}</div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {runtimeTask.checkpoint.nextAction && (
                                                                    <div className="rounded-md border border-border bg-background px-2.5 py-2">
                                                                        <div className="mb-1 text-[10px] text-muted-foreground">{language === 'zh' ? '下一步' : 'Next step'}</div>
                                                                        <div className="leading-relaxed text-foreground/82">
                                                                            {sanitizeRuntimeText(
                                                                                runtimeTask.checkpoint.nextAction,
                                                                                language === 'zh' ? '继续执行当前路线' : 'Continue with the current route',
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {runtimeFailure && (
                                                                    <div className="rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-red-500/85">
                                                                        <div className="mb-1 text-[10px] text-red-500/70">{language === 'zh' ? '最近失败' : 'Latest failure'}</div>
                                                                        <div className="leading-relaxed">
                                                                            {runtimeFailure.failureClass}: {sanitizeRuntimeText(runtimeFailure.message, language === 'zh' ? '失败原因暂不可读' : 'Failure reason is unavailable')}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <div className="rounded-md border border-border bg-background px-2.5 py-2 text-muted-foreground">
                                                                {language === 'zh' ? '当前还没有活跃任务。' : 'No active task yet.'}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <span className="truncate">{statusLabelShort}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                            <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                                {statusLabel}
                            </span>
                            <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground/80">
                                {username ? `${username}@${host}` : stageHint}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="min-h-0 flex-1 p-4">
                    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background">
                        <div className="flex items-center justify-between border-b border-border px-4 py-3">
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1.5">
                                    <span className="h-2.5 w-2.5 rounded-full bg-rose-300/80" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-amber-300/85" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/85" />
                                </div>
                                <span className="text-sm font-medium text-foreground">
                                    {language === 'zh' ? '执行画布' : 'Execution Canvas'}
                                </span>
                            </div>
                            <span className="text-xs text-muted-foreground">{stageHint}</span>
                        </div>

                        <div className="agent-terminal-shell flex-1 overflow-hidden bg-background">
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
