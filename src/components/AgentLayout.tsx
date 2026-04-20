import { useRef, useState, useCallback, useEffect } from 'react';
import {
    Activity,
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
import { AgentTaskOverview } from './AgentTaskOverview';
import { AgentSessionSidebar } from './AgentSessionSidebar';
import { AgentPlanPhase, AgentSession, AgentSessionRuntime } from '../shared/types';
import { ErrorBoundary } from './ErrorBoundary';
import { TerminalSlotConsumer } from './TerminalSlot';
import { TerminalConnecting } from './ConnectingOverlay';
import { PanelSlotConsumer, PanelName } from './PanelSlot';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';
import logoUrl from '../assets/logo.png';

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
    const onlineLabel = connected
        ? (language === 'zh' ? '在线' : 'Online')
        : connecting
            ? (language === 'zh' ? '连接中' : 'Connecting')
            : (language === 'zh' ? '离线' : 'Offline');
    const onlineDotClass = connected
        ? 'bg-emerald-400'
        : connecting
            ? 'bg-amber-400 animate-pulse'
            : 'bg-rose-400';
    const onlinePillClass = connected
        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500'
        : connecting
            ? 'border-amber-500/25 bg-amber-500/10 text-amber-500'
            : 'border-rose-500/25 bg-rose-500/10 text-rose-500';

    const workspaceTitle = language === 'zh' ? 'Agent 工作区' : 'Agent Workspace';
    const stageTitle = language === 'zh' ? 'Reflex' : 'Reflex';
    const stageHint = language === 'zh' ? '实时终端与执行结果' : 'Live terminal and execution output';
    const canvasTitle = host || (language === 'zh' ? '服务器' : 'Server');

    const planSteps = currentRuntime?.planState?.plan || [];
    const completedSteps = planSteps.filter((step) => step.status === 'completed' || step.status === 'skipped').length;
    const activeStep = planSteps.find((step) => step.status === 'in_progress' || step.status === 'waiting_approval');
    const statusLabelShort = currentRuntime?.planStatus === 'executing'
        ? (language === 'zh' ? '执行中' : 'Running')
        : currentRuntime?.planStatus === 'generating'
            ? (language === 'zh' ? '分析中' : 'Analyzing')
            : currentRuntime?.planStatus === 'paused'
                ? (language === 'zh' ? '等待继续' : 'Waiting to continue')
                : currentRuntime?.planStatus === 'blocked'
                    ? (language === 'zh' ? '已阻塞' : 'Blocked')
                : currentRuntime?.planStatus === 'waiting_approval'
                    ? (language === 'zh' ? '等待批准' : 'Waiting for approval')
                    : currentRuntime?.planStatus === 'done'
                        ? (language === 'zh' ? '已完成' : 'Completed')
                        : currentRuntime?.planStatus === 'stopped'
                            ? (language === 'zh' ? '已停止' : 'Stopped')
                            : (language === 'zh' ? '待命' : 'Idle');
    const progressLabel = planSteps.length > 0
        ? (language === 'zh' ? `当前进度 ${completedSteps}/${planSteps.length}` : `Progress ${completedSteps}/${planSteps.length}`)
        : (language === 'zh' ? '等待创建计划' : 'Plan not started');
    const progressPercent = planSteps.length > 0 ? Math.round((completedSteps / planSteps.length) * 100) : 0;
    const runtimeTask = currentRuntime?.activeTaskRun || null;
    const runtimeRoute = runtimeTask?.activeHypothesisId
        ? runtimeTask.hypotheses.find((item) => item.id === runtimeTask.activeHypothesisId)?.kind || runtimeTask.activeHypothesisId
        : null;
    const runtimeTodos = runtimeTask?.taskTodos || currentRuntime?.taskTodos || [];
    const runtimeCompletedTodoCount = runtimeTodos.filter((todo) => todo.status === 'completed').length;
    const runtimeActiveTodo = runtimeTodos.find((todo) => todo.status === 'in_progress') || runtimeTodos[0];
    const runtimeTodoProgressPercent = runtimeTodos.length > 0
        ? Math.round((runtimeCompletedTodoCount / runtimeTodos.length) * 100)
        : progressPercent;
    const progressTone = currentRuntime?.planStatus === 'blocked' || runtimeTask?.status === 'blocked'
        ? 'warning'
        : currentRuntime?.planStatus === 'paused' || currentRuntime?.planStatus === 'waiting_approval' || currentRuntime?.planStatus === 'stopped'
            ? 'muted'
            : currentRuntime?.planStatus === 'done'
                ? 'primary'
                : currentRuntime?.planStatus === 'executing' || currentRuntime?.planStatus === 'generating'
                    ? 'primary'
                    : 'muted';
    const runtimeCurrentAction = sanitizeRuntimeText(
        runtimeTask?.currentAction,
        sanitizeRuntimeText(
            runtimeActiveTodo?.content,
            currentRuntime?.planStatus === 'generating'
                ? (language === 'zh' ? '正在分析仓库与服务器上下文' : 'Analyzing repository and server context')
                : currentRuntime?.planStatus === 'executing'
                    ? (language === 'zh' ? '正在推进当前任务' : 'Advancing the current task')
                    : (language === 'zh' ? '等待新的任务目标' : 'Waiting for a new goal'),
        ),
    );
    const runtimeDescription = currentRuntime?.planStatus === 'generating'
        ? (language === 'zh' ? '正在形成路线、检查仓库与服务器事实，并准备真正执行。' : 'Building routes, validating repo and server facts, and preparing to execute.')
        : currentRuntime?.planStatus === 'executing'
            ? (language === 'zh' ? '现在会持续推进，不需要你反复催；除非被阻塞或你手动停止。' : 'The agent will keep moving until it is blocked or you stop it.')
            : currentRuntime?.planStatus === 'blocked'
                ? (language === 'zh' ? '当前已被阻塞，补齐缺失信息后就能从原位置接着跑。' : 'The task is blocked and can resume from the same state once the missing input is provided.')
                : (language === 'zh' ? '当前任务状态已保留，可继续衔接。' : 'The current task state is preserved and ready to continue.');
    const runtimeNextAction = sanitizeRuntimeText(
        runtimeTask?.checkpoint?.nextAction || '',
        runtimeActiveTodo?.status === 'in_progress'
            ? runtimeActiveTodo.content
            : (language === 'zh' ? '等待生成下一步动作' : 'Waiting for the next concrete action'),
    );
    const runtimeLastProgress = sanitizeRuntimeText(runtimeTask?.checkpoint?.lastProgressNote || '');
    const progressHint = language === 'zh' ? '点击查看任务详情' : 'Click for task details';
    return (
        <div
            ref={layoutRef}
            className="flex h-full w-full gap-3 overflow-hidden bg-background"
            style={{ padding: 'var(--panel-gap)' }}
        >
            <div className="flex h-full w-14 shrink-0 flex-col items-center border-r border-border bg-card py-3">
                <div className="flex flex-col items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-border bg-background text-foreground">
                        <img src={logoUrl} alt="Reflex" className="h-6 w-6 rounded-md object-cover" />
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
                                <img src={logoUrl} alt="Reflex" className="h-3.5 w-3.5 rounded-sm object-cover" />
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
                <div className="border-b border-border px-5 py-3.5">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground">
                                <Monitor className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <div className="truncate text-sm font-semibold text-foreground">{stageTitle}</div>
                                    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium', onlinePillClass)}>
                                        <span className={cn('h-1.5 w-1.5 rounded-full', onlineDotClass)} />
                                        {onlineLabel}
                                    </span>
                                </div>
                                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <div className="relative" ref={progressPopoverRef}>
                                        <button
                                            type="button"
                                            onClick={() => setProgressPopoverOpen((value) => !value)}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent"
                                            title={progressHint}
                                        >
                                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                            <span>{progressLabel}</span>
                                            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', progressPopoverOpen && 'rotate-180')} />
                                        </button>
                                        {progressPopoverOpen && (
                                            <div
                                                className="absolute left-0 top-full z-30 mt-2 w-[560px] max-w-[min(560px,calc(100vw-120px))] overflow-hidden rounded-xl border border-border bg-card shadow-none"
                                                style={{ maxHeight: 'calc(100vh - 180px)' }}
                                            >
                                                <div
                                                    className="overflow-y-auto p-3"
                                                    style={{ maxHeight: 'calc(100vh - 180px)' }}
                                                >
                                                    <AgentTaskOverview
                                                        statusLabel={statusLabelShort}
                                                        tone={progressTone}
                                                        routeLabel={runtimeRoute ? (language === 'zh' ? `路线 ${runtimeRoute}` : `Route ${runtimeRoute}`) : undefined}
                                                        repairLabel={runtimeTask?.attemptCount ? (language === 'zh' ? `修复 ${runtimeTask.attemptCount}/5` : `Repair ${runtimeTask.attemptCount}/5`) : undefined}
                                                        headline={runtimeCurrentAction}
                                                        description={runtimeDescription}
                                                        nextAction={runtimeNextAction}
                                                        nextActionLabel={language === 'zh' ? '下一步' : 'Next'}
                                                        lastProgress={runtimeLastProgress}
                                                        lastProgressLabel={language === 'zh' ? '最近确认的进展' : 'Last confirmed progress'}
                                                        blockingReason={runtimeTask?.blockingReason && runtimeTask.status === 'blocked'
                                                            ? sanitizeRuntimeText(runtimeTask.blockingReason, language === 'zh' ? '需要补充信息后继续' : 'Waiting for missing input')
                                                            : undefined}
                                                        blockingReasonLabel={language === 'zh' ? '阻塞原因' : 'Blocking reason'}
                                                        progressLabel={language === 'zh' ? '任务推进' : 'Task progress'}
                                                        progressValue={runtimeTodos.length > 0 ? `${runtimeCompletedTodoCount}/${runtimeTodos.length}` : `${runtimeTodoProgressPercent}%`}
                                                        progressPercent={runtimeTodoProgressPercent}
                                                        todos={runtimeTodos.slice(0, 4)}
                                                        emptyTodosLabel={language === 'zh'
                                                            ? '任务清单还在生成中，当前动作和路线会先持续更新。'
                                                            : 'The task list is still being formed. The live action and route will keep updating first.'}
                                                        completedLabel={language === 'zh' ? '已完成' : 'Completed'}
                                                        inProgressLabel={language === 'zh' ? '进行中' : 'In progress'}
                                                        pendingLabel={language === 'zh' ? '待处理' : 'Pending'}
                                                        animated={currentRuntime?.planStatus === 'executing' || currentRuntime?.planStatus === 'generating'}
                                                        className="border-0 shadow-none"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <span className="truncate">{statusLabelShort}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex min-w-0 shrink-0 items-center gap-2">
                            <span className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground/80">
                                {username && host ? `${username}@${host}` : stageHint}
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
                                    {canvasTitle}
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
