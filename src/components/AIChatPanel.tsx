// AIChatPanel - Agent mode chat interface
import { useState, useRef, useEffect, KeyboardEvent, memo } from 'react';
import { User, Send, Sparkles, ChevronDown, ChevronRight, Terminal, Square, Zap, Shield, ShieldCheck, Check, X, Cpu, FileText, FolderOpen, Brain, Pencil, ListChecks, ChevronUp, CheckCircle2, XCircle, Target, AlertTriangle, ShieldAlert, Package } from 'lucide-react';
import { aiService } from '../services/aiService';
import { AI_SYSTEM_PROMPTS, AGENT_TOOLS, AIProviderProfile, AI_PROVIDER_CONFIGS, PlanState } from '../shared/aiTypes';
import { AgentCompactState, AgentMemoryFileSummary, AgentPlanPhase, AgentSessionRuntime, TaskRunSummary, TaskTodoItem } from '../shared/types';
import { useSettingsStore } from '../store/settingsStore';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';
import logoUrl from '../assets/logo.png';

export interface AgentMessage {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
    toolCall?: {
        name: string;
        command: string;
        status: 'pending' | 'executed';
    };
    reasoning?: string;  // AI thinking/reasoning content (DeepSeek)
    isStreaming?: boolean;
    isError?: boolean;  // marks messages that should show error shake animation
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    modelUsed?: string;
}

interface AIChatPanelProps {
    connectionId: string;
    profileId: string;           // SSH connection id used for session binding
    host: string;                // displayed server hostname
    messages: AgentMessage[];
    onMessagesChange: (messages: AgentMessage[]) => void;
    onExecuteCommand: (command: string) => void;
    sessionId: string;           // current session id managed by parent
    restoredRuntime?: AgentSessionRuntime | null;
    onSaveComplete?: () => void; // notifies sidebar to refresh
    onRuntimeChange?: (runtime: AgentSessionRuntime | null) => void;
    className?: string;
}

const DEPLOY_INTENT_RE = /(?:\bdeploy\b|\bpublish\b|部署|发布|上线)/i;
const LOCAL_PROJECT_PATH_RE = (() => {
    const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
    return isWindows
        ? /(?:[A-Za-z]:\\|\\\\)[^\r\n"'`<>|,，。；：、]+(?: [^\r\n"'`<>|,，。；：、]+)*/g
        : /\/(?:Users|home|opt|srv|var|tmp)[^\s\r\n"'`<>|,，。；：、]*/g;
})();
const CONTINUE_INTENT_RE = /^(继续|继续处理|继续执行|继续部署|接着|接着做|再试一次|重试|continue|resume|retry)\s*[。.!！]?$/i;
const OPTION_SELECTION_RE = /^(?:[ab]|[12]|option\s*[ab12]|方案\s*[ab]|选\s*[ab12])$/i;
const STATUS_QUERY_RE = /^(?:status|what are you doing|what's the current status|what is the current status|你现在在干什么|现在在做什么|当前在做什么|当前进度|什么进度|啥进度)\s*[?？!！]*$/i;
const ACKNOWLEDGEMENT_RE = /^(?:好的?|好滴|好呢|知道了|收到|收到啦|明白了|行|行吧|可以|嗯|嗯嗯|ok|okay|got it|roger|thanks|thank you|thx)\s*[。.!！~～]*$/i;
const ASK_USER_PREFIX_RE = /^ASK_USER:/i;

function extractDeployProjectPath(input: string): string | null {
    const matches = input.match(LOCAL_PROJECT_PATH_RE);
    if (!matches?.length) return null;
    return matches.sort((a, b) => b.length - a.length)[0].trim();
}

function formatTemplate(template: string, values: Record<string, string>) {
    return Object.entries(values).reduce(
        (acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), value),
        template,
    );
}

function normalizeRestoredPlanStatus(status?: AgentPlanPhase): AgentPlanPhase {
    if (!status) return 'idle';
    if (status === 'executing' || status === 'generating') return 'stopped';
    return status;
}

export function AIChatPanel({
    connectionId,
    profileId,
    host,
    messages,
    onMessagesChange,
    onExecuteCommand,
    sessionId,
    restoredRuntime,
    onSaveComplete,
    onRuntimeChange,
    className,
}: AIChatPanelProps) {
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [pendingCommands, setPendingCommands] = useState<{ cmd: string; msgId: string; aiMessages: any[] }[]>([]);
    const [showModeMenu, setShowModeMenu] = useState(false);
    const [showModelMenu, setShowModelMenu] = useState(false);
    const [agentModel, setAgentModel] = useState('');         // '' = use profile's default model
    const [agentProfileId, setAgentProfileId] = useState(''); // '' = use active profile
    const [modelInput, setModelInput] = useState('');          // text field in picker
    // Plan mode state
    const planMode = true; // Plan mode is always enabled in agent workspace
    const [planState, setPlanState] = useState<PlanState | null>(null);
    const [contextWindow, setContextWindow] = useState<{ promptTokens: number; limitTokens: number; percentUsed: number; compressionCount: number; autoCompressed: boolean; summaryChars: number; } | null>(null);
    const [planStatus, setPlanStatus] = useState<AgentPlanPhase>('idle');
    const [compressedMemory, setCompressedMemory] = useState('');
    const [knownProjectPaths, setKnownProjectPaths] = useState<string[]>([]);
    const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined);
    const [activeTaskRun, setActiveTaskRun] = useState<TaskRunSummary | null>(null);
    const [compressedRunMemory, setCompressedRunMemory] = useState('');
    const [taskTodos, setTaskTodos] = useState<TaskTodoItem[]>([]);
    const [memoryFiles, setMemoryFiles] = useState<AgentMemoryFileSummary[]>([]);
    const [compactState, setCompactState] = useState<AgentCompactState | null>(null);
    const planStateRef = useRef<PlanState | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const modeMenuRef = useRef<HTMLDivElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const latestMessagesRef = useRef(messages);
    const onMessagesChangeRef = useRef(onMessagesChange);
    const activeTaskRunRef = useRef<TaskRunSummary | null>(null);
    const runtimeSnapshotRef = useRef<AgentSessionRuntime | null>(null);
    const selectedProfileRef = useRef<AIProviderProfile | undefined>(undefined);
    const autoResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const restoredAutoResumeKeyRef = useRef('');
    const scheduledAutoResumeKeyRef = useRef('');
    const { aiSendShortcut, agentControlMode, setAgentControlMode, agentWhitelist, aiProfiles, activeProfileId } = useSettingsStore();
    const { t, language } = useTranslation();
    const agentControlModeRef = useRef(agentControlMode);
    const agentWhitelistRef = useRef(agentWhitelist);
    const isLoadingRef = useRef(false);
    const envContextRef = useRef<string>(''); // cached server environment for agent system prompt
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionIdRef = useRef(sessionId);
    const pendingChatDeployRef = useRef<{ chatSessionId: string; projectRoot: string } | null>(null);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
    useEffect(() => { onMessagesChangeRef.current = onMessagesChange; }, [onMessagesChange]);

    const getBaseProfile = () => aiProfiles.find(p => p.id === (agentProfileId || activeProfileId));
    const getSelectedProfile = () => {
        const profile = getBaseProfile();
        if (!profile) return undefined;
        return agentModel ? { ...profile, model: agentModel } : profile;
    };

    const buildRuntimeSnapshot = (): AgentSessionRuntime => ({
        planState,
        planStatus,
        contextWindow,
        compressedMemory,
        knownProjectPaths,
        agentModel,
        agentProfileId,
        activeRunId,
        activeTaskRun,
        compressedRunMemory,
        taskTodos,
        memoryFiles,
        compactState: compactState || undefined,
    });

    const buildAutoResumeKey = (run?: TaskRunSummary | null, currentSessionId = sessionId) => {
        if (!run || run.status !== 'retryable_paused' || !run.nextAutoRetryAt) return '';
        return `${currentSessionId}:${run.id}:${run.autoRetryCount ?? 0}:${run.nextAutoRetryAt}`;
    };

    const clearAutoResumeTimer = () => {
        if (autoResumeTimerRef.current) {
            clearTimeout(autoResumeTimerRef.current);
            autoResumeTimerRef.current = null;
        }
    };

    // Inject CSS keyframes for AI chat animations (runs once)
    useEffect(() => {
        const STYLE_ID = 'agent-chat-keyframes';
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
@keyframes agentCursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes agentShimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
@keyframes agentThinkingLine {
  0%   { transform: translateX(-70%); opacity: 0; }
  18%  { opacity: 0.8; }
  82%  { opacity: 0.8; }
  100% { transform: translateX(130%); opacity: 0; }
}
@keyframes agentWaveDot {
  0%, 100% { transform: translateY(0); opacity: 0.35; }
  50%       { transform: translateY(-5px); opacity: 1; }
}
@keyframes agentAccordionIn {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes agentSlideInUp {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes agentShakeX {
  0%, 100% { transform: translateX(0); }
  20%       { transform: translateX(-4px); }
  40%       { transform: translateX(4px); }
  60%       { transform: translateX(-3px); }
  80%       { transform: translateX(3px); }
}
@keyframes agentSweepWide {
  0%   { transform: translateX(-140%); }
  100% { transform: translateX(240%); }
}
@keyframes agentPulseRing {
  0%, 100% { transform: scale(1); opacity: 0.35; }
  50% { transform: scale(1.08); opacity: 0.8; }
}
@keyframes agentFloatBreath {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}
.agent-chat-input textarea,
.agent-chat-input textarea:focus,
.agent-chat-input textarea:focus-visible,
.agent-chat-input textarea:active {
  outline: none !important;
  box-shadow: none !important;
}
`;
        document.head.appendChild(style);
    }, []);

    // Click-outside to dismiss popover menus
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (showModeMenu && modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
                setShowModeMenu(false);
            }
            if (showModelMenu && modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
                setShowModelMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showModeMenu, showModelMenu]);

    // Keep refs in sync
    useEffect(() => { latestMessagesRef.current = messages; }, [messages]);
    useEffect(() => { agentControlModeRef.current = agentControlMode; }, [agentControlMode]);
    useEffect(() => { agentWhitelistRef.current = agentWhitelist; }, [agentWhitelist]);
    useEffect(() => { activeTaskRunRef.current = activeTaskRun; }, [activeTaskRun]);
    useEffect(() => { selectedProfileRef.current = getSelectedProfile(); }, [aiProfiles, agentProfileId, activeProfileId, agentModel]);

    // Restore per-chat execution state when switching sessions.
    useEffect(() => {
        const runtime = restoredRuntime || null;
        const nextPlanState = runtime?.planState || null;
        const nextPlanStatus = normalizeRestoredPlanStatus(runtime?.planStatus);
        const nextActiveTaskRun = runtime?.activeTaskRun || null;
        const nextSnapshot: AgentSessionRuntime = {
            planState: nextPlanState,
            planStatus: nextPlanStatus,
            contextWindow: runtime?.contextWindow || null,
            compressedMemory: runtime?.compressedMemory || '',
            knownProjectPaths: runtime?.knownProjectPaths || [],
            agentModel: runtime?.agentModel || '',
            agentProfileId: runtime?.agentProfileId || '',
            activeRunId: runtime?.activeRunId,
            activeTaskRun: nextActiveTaskRun,
            compressedRunMemory: runtime?.compressedRunMemory || '',
            taskTodos: runtime?.taskTodos || [],
            memoryFiles: runtime?.memoryFiles || [],
            compactState: runtime?.compactState || undefined,
        };

        setPlanState(nextPlanState);
        planStateRef.current = nextPlanState;
        setContextWindow(runtime?.contextWindow || null);
        setPlanStatus(nextPlanStatus);
        setCompressedMemory(runtime?.compressedMemory || '');
        setKnownProjectPaths(runtime?.knownProjectPaths || []);
        setAgentModel(runtime?.agentModel || '');
        setAgentProfileId(runtime?.agentProfileId || '');
        setActiveRunId(runtime?.activeRunId);
        setActiveTaskRun(nextActiveTaskRun);
        activeTaskRunRef.current = nextActiveTaskRun;
        setCompressedRunMemory(runtime?.compressedRunMemory || '');
        setTaskTodos(runtime?.taskTodos || []);
        setMemoryFiles(runtime?.memoryFiles || []);
        setCompactState(runtime?.compactState || null);
        runtimeSnapshotRef.current = nextSnapshot;
        clearAutoResumeTimer();
        restoredAutoResumeKeyRef.current = buildAutoResumeKey(nextActiveTaskRun, sessionId);
        scheduledAutoResumeKeyRef.current = '';
        setPendingCommands([]);
        setIsLoading(false);
        isLoadingRef.current = false;
    }, [sessionId]);

    // 鈹€鈹€ Auto-save session to store (debounced 800ms) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    useEffect(() => {
        if (messages.length === 0) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            const sid = sessionIdRef.current;
            if (!sid || !profileId) return;
            // Auto-generate title from last user message (most recent topic)
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            const title = lastUser
                ? lastUser.content.replace(/\s+/g, ' ').slice(0, 40) + (lastUser.content.length > 40 ? '...' : '')
                : t('agent.newSession');
            const session = {
                id: sid,
                title,
                profileId,
                host,
                messages,
                runtime: buildRuntimeSnapshot(),
                createdAt: messages[0]?.timestamp || Date.now(),
                updatedAt: Date.now(),
            };
            try {
                await (window as any).electron.agentSessionSave(session);
                onSaveComplete?.();
            } catch (e) {
                console.warn('Failed to save agent session:', e);
            }
        }, 800);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, planState, planStatus, contextWindow, compressedMemory, knownProjectPaths, agentModel, agentProfileId, activeRunId, activeTaskRun, compressedRunMemory, taskTodos, memoryFiles, compactState]);

    useEffect(() => {
        const runtime = buildRuntimeSnapshot();
        runtimeSnapshotRef.current = runtime;
        onRuntimeChange?.(runtime);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [planState, planStatus, contextWindow, compressedMemory, knownProjectPaths, agentModel, agentProfileId, activeRunId, activeTaskRun, compressedRunMemory, taskTodos, memoryFiles, compactState]);

    useEffect(() => {
        const restoreKey = restoredAutoResumeKeyRef.current;
        const currentKey = buildAutoResumeKey(activeTaskRun);
        if (!restoreKey || !currentKey || currentKey !== restoreKey) {
            if (!currentKey) {
                restoredAutoResumeKeyRef.current = '';
                scheduledAutoResumeKeyRef.current = '';
            }
            clearAutoResumeTimer();
            return;
        }

        if (scheduledAutoResumeKeyRef.current === currentKey) {
            return;
        }

        const profile = selectedProfileRef.current;
        const eWin = window as any;
        if (!profile || !eWin.electron?.agentPlanResume) {
            return;
        }

        clearAutoResumeTimer();
        scheduledAutoResumeKeyRef.current = currentKey;
        const delayMs = Math.max(250, (activeTaskRun?.nextAutoRetryAt || Date.now()) - Date.now());

        autoResumeTimerRef.current = setTimeout(async () => {
            autoResumeTimerRef.current = null;
            const latestRun = activeTaskRunRef.current;
            if (buildAutoResumeKey(latestRun) !== currentKey || latestRun?.status !== 'retryable_paused') {
                if (!latestRun || latestRun.status !== 'retryable_paused') {
                    restoredAutoResumeKeyRef.current = '';
                    scheduledAutoResumeKeyRef.current = '';
                }
                return;
            }

            restoredAutoResumeKeyRef.current = '';
            scheduledAutoResumeKeyRef.current = '';
            setIsLoading(true);
            isLoadingRef.current = true;

            try {
                await eWin.electron.agentPlanResume({
                    sessionId,
                    connectionId,
                    userInput: 'continue',
                    profile: selectedProfileRef.current,
                    sshHost: host,
                    threadMessages: latestMessagesRef.current,
                    restoredRuntime: runtimeSnapshotRef.current || buildRuntimeSnapshot(),
                });
            } catch (err) {
                setIsLoading(false);
                isLoadingRef.current = false;
                console.warn('Failed to auto-resume restored agent session:', err);
            }
        }, delayMs);

        return () => {
            clearAutoResumeTimer();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, connectionId, host, activeTaskRun?.id, activeTaskRun?.status, activeTaskRun?.nextAutoRetryAt, activeTaskRun?.autoRetryCount, aiProfiles, agentProfileId, activeProfileId, agentModel]);

    useEffect(() => () => {
        clearAutoResumeTimer();
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
        }
    }, [input]);

    // Subscribe to main-process Agent plan push events (re-bind when tab changes)
    useEffect(() => {
        const eWin = window as any;
        const cleanPlan = eWin.electron?.onAgentPlanUpdate?.(
            ({ sessionId: eventSessionId, planState: ps, planPhase, contextWindow: ctxWindow, compressedMemory: nextCompressedMemory, compressedRunMemory: nextCompressedRunMemory, knownProjectPaths: nextKnownProjectPaths, activeRunId: nextRunId, activeTaskRun: nextTaskRun, taskTodos: nextTaskTodos, memoryFiles: nextMemoryFiles, compactState: nextCompactState }: any) => {
                if (eventSessionId !== sessionIdRef.current) return;
                setPlanState(ps);
                planStateRef.current = ps;
                setContextWindow(ctxWindow || null);
                setPlanStatus(planPhase);
                setCompressedMemory(nextCompressedMemory || '');
                setKnownProjectPaths(Array.isArray(nextKnownProjectPaths) ? nextKnownProjectPaths : []);
                setActiveRunId(typeof nextRunId === 'string' ? nextRunId : undefined);
                setActiveTaskRun(nextTaskRun || null);
                setCompressedRunMemory(nextCompressedRunMemory || '');
                setTaskTodos(Array.isArray(nextTaskTodos) ? nextTaskTodos : []);
                setMemoryFiles(Array.isArray(nextMemoryFiles) ? nextMemoryFiles : []);
                setCompactState(nextCompactState || null);
                if (['executing', 'generating'].includes(planPhase)) {
                    setIsLoading(true);
                    isLoadingRef.current = true;
                }
                if (['done', 'stopped', 'paused', 'blocked', 'waiting_approval'].includes(planPhase)) {
                    setIsLoading(false);
                    isLoadingRef.current = false;
                }
            });
        const cleanMsg = eWin.electron?.onAgentPushMsg?.(
            ({ sessionId: eventSessionId, message }: any) => {
                if (eventSessionId !== sessionIdRef.current) return;
                onMessagesChangeRef.current([...latestMessagesRef.current, message]);
            });
        const cleanUpd = eWin.electron?.onAgentUpdateMsg?.(
            ({ sessionId: eventSessionId, messageId, updates }: any) => {
                if (eventSessionId !== sessionIdRef.current) return;
                onMessagesChangeRef.current(latestMessagesRef.current.map((m: any) =>
                    m.id === messageId ? { ...m, ...updates } : m));
            });
        return () => { cleanPlan?.(); cleanMsg?.(); cleanUpd?.(); };
    }, []);

    useEffect(() => {
        const eWin = window as any;
        const cleanFinished = eWin.electron?.onDeployRunFinished?.(({ sessionId: deploySessionId, run }: any) => {
            const pending = pendingChatDeployRef.current;
            if (!pending) return;
            if (deploySessionId !== connectionId || pending.chatSessionId !== sessionIdRef.current) return;

            pendingChatDeployRef.current = null;
            const content = run?.status === 'completed'
                ? `部署已完成。\n访问地址：${run?.outputs?.url || run?.outputs?.healthCheckUrl || host}`
                : `部署失败，系统已自动尝试修复但仍未完成。\n${run?.error || '未知错误'}`;
            onMessagesChangeRef.current([
                ...latestMessagesRef.current,
                {
                    id: `deploy-finished-${Date.now()}`,
                    role: 'assistant',
                    content,
                    timestamp: Date.now(),
                    isError: run?.status !== 'completed',
                },
            ]);
        });
        return () => { cleanFinished?.(); };
    }, [connectionId, host]);

    // Execute a command via SSH exec IPC and return result
    // Auto-retries up to 5 times on connection errors, attempting to reconnect between tries.
    const execCommand = async (command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        const eWindow = window as any;
        if (!eWindow.electron?.sshExec) {
            throw new Error('SSH exec not available');
        }

        const MAX_RETRIES = 5;
        const RETRY_DELAY_MS = 3000;
        const isConnError = (msg: string) =>
            /not connected|no response|handshake|connection lost|ECONNRESET|ETIMEDOUT/i.test(msg);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt === 1) {
                    // Show command in terminal display (NOT PTY stdin 鈥?no pager, no double-exec)
                    eWindow.electron.terminalInject?.(connectionId, `\r\n\x1b[36;2m[Agent] $ ${command}\x1b[0m\r\n`);
                }
                // Suppress pager programs so output always returns cleanly
                const wrapped = `PAGER=cat SYSTEMD_PAGER=cat GIT_PAGER=cat TERM=dumb ${command}`;
                // 120s timeout: package installs (apt/yum/pip) can take several minutes
                const result = await eWindow.electron.sshExec(connectionId, wrapped, 120000);
                // Inject output into terminal display so user can observe
                if (result.stdout) {
                    eWindow.electron.terminalInject?.(connectionId, result.stdout.replace(/\n/g, '\r\n'));
                }
                if (result.stderr) {
                    eWindow.electron.terminalInject?.(connectionId, `\x1b[33m${result.stderr.replace(/\n/g, '\r\n')}\x1b[0m`);
                }
                eWindow.electron.terminalInject?.(connectionId, `\x1b[2m[exit ${result.exitCode}]\x1b[0m\r\n`);
                return result;
            } catch (err: any) {
                const errMsg: string = err?.message || String(err);
                if (isConnError(errMsg) && attempt < MAX_RETRIES) {
                    // Notify in terminal that we're reconnecting
                    eWindow.electron.terminalInject?.(connectionId,
                        `\r\n\x1b[33m[Agent] 连接中断，${RETRY_DELAY_MS / 1000}s 后重试 (${attempt}/${MAX_RETRIES})...\x1b[0m\r\n`
                    );
                    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                    // Attempt to reconnect
                    try {
                        const reconnResult = await eWindow.electron.sshReconnect?.(connectionId);
                        if (reconnResult?.success) {
                            eWindow.electron.terminalInject?.(connectionId,
                                `\x1b[32m[Agent] 重连成功，继续执行...\x1b[0m\r\n`
                            );
                        } else {
                            eWindow.electron.terminalInject?.(connectionId,
                                `\x1b[31m[Agent] 重连失败: ${reconnResult?.error || '未知错误'}\x1b[0m\r\n`
                            );
                        }
                    } catch (_reconnErr) {
                        // reconnect threw 鈥?continue anyway, sshExec will fail again if truly down
                    }
                    // Re-show the command indicator for next attempt
                    eWindow.electron.terminalInject?.(connectionId,
                        `\x1b[36;2m[Agent] $ ${command}  (重试 ${attempt + 1}/${MAX_RETRIES})\x1b[0m\r\n`
                    );
                    continue;
                }
                // Not a connection error, or out of retries
                throw err;
            }
        }
        throw new Error('SSH exec failed after maximum retries');
    };


    // Check if a command needs approval based on current mode
    const needsApproval = (command: string): boolean => {
        const mode = agentControlModeRef.current;
        if (mode === 'auto') return false;
        if (mode === 'approval') return true;
        // whitelist mode: check first word
        const firstWord = command.trim().split(/\s+/)[0];
        const whitelist = agentWhitelistRef.current;
        return !whitelist.some(w => firstWord === w);
    };

    // Build ChatMessage array from our AgentMessages for the AI API
    // Sliding window: only last 20 messages to prevent token overflow.
    // Older messages stay visible in the UI but are NOT sent to the API.
    const CONTEXT_WINDOW = 20;

    // Strip ANSI escape codes and truncate long outputs before feeding to LLM
    const denoiseOutput = (raw: string, maxLines = 100): string => {
        const stripped = raw.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').replace(/\r/g, '');
        const lines = stripped.split('\n').filter(l => l.trim());
        if (lines.length <= maxLines) return lines.join('\n');
        const head = lines.slice(0, 30).join('\n');
        const tail = lines.slice(-20).join('\n');
        return `${head}\n\n[...省略 ${lines.length - 50} 行...]\n\n${tail}`;
    };
    const buildRuntimeStatusReply = () => {
        const runtimeTodos = activeTaskRun?.taskTodos?.length ? activeTaskRun.taskTodos : taskTodos;
        const completedTodoCount = runtimeTodos.filter((item) => item.status === 'completed').length;
        const activeTodo = runtimeTodos.find((item) => item.status === 'in_progress') || runtimeTodos[0];
        const runtimeRoute = activeTaskRun?.activeHypothesisId
            ? activeTaskRun.hypotheses.find((item) => item.id === activeTaskRun.activeHypothesisId)?.kind || activeTaskRun.activeHypothesisId
            : null;
        const statusLabel = planStatus === 'executing'
            ? (language === 'zh' ? '执行中' : 'Running')
            : planStatus === 'generating'
                ? (language === 'zh' ? '分析中' : 'Analyzing')
                : planStatus === 'paused'
                    ? (language === 'zh' ? '等待继续' : 'Waiting')
                    : planStatus === 'blocked'
                        ? (language === 'zh' ? '已阻塞' : 'Blocked')
                        : planStatus === 'waiting_approval'
                            ? (language === 'zh' ? '待批准' : 'Pending approval')
                            : planStatus === 'done'
                                ? (language === 'zh' ? '已完成' : 'Completed')
                                : planStatus === 'stopped'
                                    ? (language === 'zh' ? '已停止' : 'Stopped')
                                    : (language === 'zh' ? '待命' : 'Idle');
        const headline = activeTaskRun?.currentAction
            || activeTodo?.content
            || (language === 'zh' ? '当前没有进行中的动作' : 'There is no active action right now');
        const nextAction = activeTaskRun?.checkpoint?.nextAction
            || (activeTodo?.status === 'in_progress' ? activeTodo.content : '')
            || (language === 'zh' ? '等待生成下一步动作' : 'Waiting for the next concrete action');
        const lastProgress = activeTaskRun?.checkpoint?.lastProgressNote || '';

        if (!activeTaskRun && !runtimeTodos.length && planStatus === 'idle') {
            return language === 'zh' ? '当前没有进行中的任务。' : 'There is no active task right now.';
        }

        const lines = [
            language === 'zh' ? `当前状态：${statusLabel}` : `Status: ${statusLabel}`,
            language === 'zh' ? `当前动作：${headline}` : `Current action: ${headline}`,
        ];

        if (runtimeRoute) {
            lines.push(language === 'zh' ? `当前路线：${runtimeRoute}` : `Current route: ${runtimeRoute}`);
        }
        if (runtimeTodos.length > 0) {
            lines.push(language === 'zh'
                ? `任务进度：${completedTodoCount}/${runtimeTodos.length}`
                : `Task progress: ${completedTodoCount}/${runtimeTodos.length}`);
        }
        if (lastProgress) {
            lines.push(language === 'zh' ? `最近进展：${lastProgress}` : `Last progress: ${lastProgress}`);
        }
        if (activeTaskRun?.blockingReason && activeTaskRun.status === 'blocked') {
            lines.push(language === 'zh' ? `阻塞原因：${activeTaskRun.blockingReason}` : `Blocking reason: ${activeTaskRun.blockingReason}`);
        }
        lines.push(language === 'zh' ? `下一步：${nextAction}` : `Next: ${nextAction}`);

        return lines.join('\n');
    };
    const buildChatMessages = (msgs: AgentMessage[], envCtx?: string): any[] => {
        const sysPrompt = AI_SYSTEM_PROMPTS.agent.replace(
            '{{ENV_CONTEXT}}',
            envCtx || `已连接到 ${host}`
        );
        const chatMsgs: any[] = [
            { role: 'system', content: sysPrompt },
        ];
        // Apply sliding window 鈥?take last CONTEXT_WINDOW messages
        const windowed = msgs.length > CONTEXT_WINDOW ? msgs.slice(-CONTEXT_WINDOW) : msgs;
        for (const m of windowed) {
            if (m.role === 'user') {
                chatMsgs.push({ role: 'user', content: m.content });
            } else if (m.role === 'assistant') {
                if (m.toolCall) {
                    // This was an assistant message that had a tool_call
                    chatMsgs.push({
                        role: 'assistant',
                        content: m.content || null,
                        tool_calls: [{
                            id: m.id,
                            type: 'function',
                            function: {
                                name: 'execute_ssh_command',
                                arguments: JSON.stringify({ command: m.toolCall.command }),
                            }
                        }]
                    });
                } else {
                    chatMsgs.push({ role: 'assistant', content: m.content });
                }
            } else if (m.role === 'tool') {
                chatMsgs.push({
                    role: 'tool',
                    content: m.content,
                    tool_call_id: m.toolCall?.command ? m.id.replace('-result', '') : m.id,
                });
            }
        }

        // Sanitize: ensure tool_calls and tool responses are always paired
        // 1. Collect all tool_call IDs from assistant messages
        const allToolCallIds = new Set<string>();
        for (const msg of chatMsgs) {
            if (msg.role === 'assistant' && msg.tool_calls) {
                for (const tc of msg.tool_calls) {
                    allToolCallIds.add(tc.id);
                }
            }
        }
        // 2. Collect all tool response IDs
        const allToolResponseIds = new Set<string>();
        for (const msg of chatMsgs) {
            if (msg.role === 'tool' && msg.tool_call_id) {
                allToolResponseIds.add(msg.tool_call_id);
            }
        }
        // 3. Remove orphaned tool messages (no matching assistant) and
        //    strip tool_calls from assistant messages that have no matching tool response
        return chatMsgs.filter(msg => {
            if (msg.role === 'tool') {
                return allToolCallIds.has(msg.tool_call_id);
            }
            return true;
        }).map(msg => {
            if (msg.role === 'assistant' && msg.tool_calls) {
                const hasAllResponses = msg.tool_calls.every((tc: any) => allToolResponseIds.has(tc.id));
                if (!hasAllResponses) {
                    // Strip tool_calls 鈥?treat as plain text message
                    const { tool_calls, ...rest } = msg;
                    return { ...rest, content: rest.content || '(command pending)' };
                }
            }
            return msg;
        });
    };

    // The Agent Loop
    const runAgentLoop = async (currentMessages: AgentMessage[]) => {
        let loopMessages = [...currentMessages];

        // 棣栨杩愯鏃舵帰閽堟湇鍔″櫒鐜锛堢紦瀛橈紝涓嶉噸澶嶈姹傦級
        if (!envContextRef.current) {
            try {
                const r = await execCommand(
                    'printf "USER:%s PWD:%s OS:%s DOCKER:%s" "$(whoami)" "$(pwd)" ' +
                    '"$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d \'\\\"\')" ' +
                    '"$(systemctl is-active docker 2>/dev/null || echo N/A)"'
                );
                envContextRef.current = r.stdout.trim() || `已连接到 ${host}`;
            } catch {
                envContextRef.current = `已连接到 ${host}`;
            }
        }

        while (true) {
            if (!isLoadingRef.current) break; // stopped by user

            // Show thinking indicator
            const thinkingId = `thinking-${Date.now()}`;
            const thinkingMsg: AgentMessage = {
                id: thinkingId,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                isStreaming: true,
            };
            onMessagesChange([...loopMessages, thinkingMsg]);

            try {
                const chatMessages = buildChatMessages(loopMessages, envContextRef.current);
                // Resolve the profile to use: agent-selected > active profile
                const selectedProfile = getSelectedProfile();
                const response = await aiService.completeWithTools({
                    messages: chatMessages,
                    tools: AGENT_TOOLS,
                    temperature: 0.7,
                    overrideModel: agentModel || undefined,
                    overrideProfile: selectedProfile || undefined,
                });

                // Remove thinking indicator
                // Case 1: AI returned text (no tool call) 鈥?done
                if (!response.toolCalls || response.toolCalls.length === 0) {
                    const assistantMsg: AgentMessage = {
                        id: `asst-${Date.now()}`,
                        role: 'assistant',
                        content: response.content || '(no response)',
                        reasoning: response.reasoningContent || undefined,
                        timestamp: Date.now(),
                        usage: response.usage,
                        modelUsed: response.modelUsed,
                    };
                    loopMessages = [...loopMessages, assistantMsg];
                    onMessagesChange(loopMessages);
                    break;
                }

                // Case 2: AI wants to call a tool
                const toolCall = response.toolCalls[0];
                const toolName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);

                // Determine display command and actual exec command based on tool type
                let displayCmd = '';
                let execCmd = '';
                if (toolName === 'execute_ssh_command') {
                    displayCmd = args.command;
                    execCmd = args.command;
                } else if (toolName === 'read_file') {
                    displayCmd = `read ${args.path}`;
                    execCmd = `cat ${JSON.stringify(args.path)}`;
                } else if (toolName === 'write_file') {
                    displayCmd = `write ${args.path}`;
                    // Use heredoc for safe multi-line write
                    const escaped = args.content.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
                    execCmd = `cat > ${JSON.stringify(args.path)} << 'AGENT_EOF'\n${args.content}\nAGENT_EOF`;
                } else if (toolName === 'list_directory') {
                    displayCmd = `ls ${args.path}`;
                    execCmd = `ls -la ${JSON.stringify(args.path)}`;
                } else {
                    displayCmd = `${toolName}(${JSON.stringify(args)})`;
                    execCmd = `echo "Unknown tool: ${toolName}"`;
                }

                // Add AI's thinking text + tool call intent as assistant message
                const toolCallMsgId = `call-${Date.now()}`;
                const assistantToolMsg: AgentMessage = {
                    id: toolCallMsgId,
                    role: 'assistant',
                    content: response.content || '',
                    reasoning: response.reasoningContent || undefined,
                    timestamp: Date.now(),
                    toolCall: {
                        name: toolName,
                        command: displayCmd,
                        status: 'pending',
                    },
                };
                loopMessages = [...loopMessages, assistantToolMsg];
                onMessagesChange(loopMessages);

                // Check safety mode (only for execute_ssh_command; file tools are always auto)
                if (toolName === 'execute_ssh_command' && needsApproval(execCmd)) {
                    // Queue for approval 鈥?pause the loop
                    setPendingCommands(prev => [...prev, {
                        cmd: execCmd,
                        msgId: toolCallMsgId,
                        aiMessages: loopMessages, // snapshot for resuming
                    }]);
                    break; // Loop pauses 鈥?will resume when user approves
                }

                // Execute immediately
                const result = await execCommand(execCmd);

                // Update assistant message status to executed
                loopMessages = loopMessages.map(m =>
                    m.id === toolCallMsgId
                        ? { ...m, toolCall: { ...m.toolCall!, status: 'executed' as const } }
                        : m
                );

                // Add tool result message
                const rawOutput = [result.stdout, result.stderr ? `[stderr]\n${result.stderr}` : ''].filter(Boolean).join('\n');
                const resultContent = denoiseOutput(rawOutput) || '(无输出)';

                const toolResultMsg: AgentMessage = {
                    id: `${toolCallMsgId}-result`,
                    role: 'tool',
                    content: resultContent,
                    timestamp: Date.now(),
                    toolCall: {
                        name: toolName,
                        command: displayCmd,
                        status: 'executed',
                    },
                };
                loopMessages = [...loopMessages, toolResultMsg];
                onMessagesChange(loopMessages);

                // Continue loop 鈥?AI will analyze the result
                await new Promise(r => setTimeout(r, 200)); // small delay

            } catch (err: any) {
                const errorMsg: AgentMessage = {
                    id: `error-${Date.now()}`,
                    role: 'assistant',
                    content: `错误: ${err.message}`,
                    timestamp: Date.now(),
                    isError: true,
                };
                loopMessages = [...loopMessages, errorMsg];
                onMessagesChange(loopMessages);
                break;
            }
        } // end while
    };

    // Resume agent loop after user approves a pending command
    const resumeAfterApproval = async (command: string, msgId: string, snapshotMessages: AgentMessage[]) => {
        setIsLoading(true);
        isLoadingRef.current = true;

        try {
            // Immediately update the current UI messages to show executed status
            const updatedCurrentMessages = latestMessagesRef.current.map(m =>
                m.id === msgId
                    ? { ...m, toolCall: { ...m.toolCall!, status: 'executed' as const } }
                    : m
            );
            onMessagesChange(updatedCurrentMessages);

            const result = await execCommand(command);

            // Also update the snapshot for the loop continuation
            let loopMessages = snapshotMessages.map(m =>
                m.id === msgId
                    ? { ...m, toolCall: { ...m.toolCall!, status: 'executed' as const } }
                    : m
            );

            // Add tool result
            const rawOutput2 = [result.stdout, result.stderr ? `[stderr]\n${result.stderr}` : ''].filter(Boolean).join('\n');
            const resultContent = denoiseOutput(rawOutput2) || '(无输出)';

            const toolResultMsg: AgentMessage = {
                id: `${msgId}-result`,
                role: 'tool',
                content: resultContent,
                timestamp: Date.now(),
                toolCall: { name: 'execute_ssh_command', command, status: 'executed' },
            };
            loopMessages = [...loopMessages, toolResultMsg];
            onMessagesChange(loopMessages);

            // Continue the agent loop
            await runAgentLoop(loopMessages);
        } catch (err: any) {
            const errorMsg: AgentMessage = {
                    id: `error-${Date.now()}`,
                    role: 'assistant',
                    content: `执行失败: ${err.message}`,
                    timestamp: Date.now(),
                    isError: true,
                };
            onMessagesChange([...latestMessagesRef.current, errorMsg]);
        } finally {
            setIsLoading(false);
            isLoadingRef.current = false;
        }
    };

    // 鈹€鈹€ Plan Mode v2: Planner / Executor / Assessor / Replanner 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        const trimmedInput = input.trim();
        const isContinueMessage = CONTINUE_INTENT_RE.test(trimmedInput) || OPTION_SELECTION_RE.test(trimmedInput);
        const isStatusMessage = STATUS_QUERY_RE.test(trimmedInput);
        const isAcknowledgement = ACKNOWLEDGEMENT_RE.test(trimmedInput);
        const lastAssistantContent = [...messages]
            .reverse()
            .find((message) => message.role === 'assistant' && message.content?.trim())
            ?.content
            ?.trim() || '';
        const hasResumableRun = Boolean(activeTaskRun && !['completed', 'failed'].includes(activeTaskRun.status));
        const isAnsweringExplicitAsk = Boolean(
            hasResumableRun
            && ASK_USER_PREFIX_RE.test(lastAssistantContent)
            && !isAcknowledgement
            && !isStatusMessage
        );

        const userMsg: AgentMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: trimmedInput,
            timestamp: Date.now(),
        };

        const updatedMessages = [...messages, userMsg];
        onMessagesChange(updatedMessages);
        setInput('');

        if (isStatusMessage) {
            const statusReply: AgentMessage = {
                id: `status-${Date.now()}`,
                role: 'assistant',
                content: buildRuntimeStatusReply(),
                timestamp: Date.now(),
            };
            onMessagesChange([...updatedMessages, statusReply]);
            return;
        }

        if (isAcknowledgement) {
            const ackReply: AgentMessage = {
                id: `ack-${Date.now()}`,
                role: 'assistant',
                content: hasResumableRun
                    ? (language === 'zh'
                        ? '收到，当前不会自动继续旧任务；如果你要接着做，直接发“继续”。'
                        : 'Noted. I will not resume the previous task automatically; say "continue" if you want to resume it.')
                    : (language === 'zh' ? '收到。' : 'Got it.'),
                timestamp: Date.now(),
            };
            onMessagesChange([...updatedMessages, ackReply]);
            return;
        }

        if (!aiService.isConfigured()) {
            const errorMsg: AgentMessage = {
                id: Date.now().toString(),
                role: 'assistant',
                content: '请先在设置中配置 AI API Key',
                timestamp: Date.now(),
            };
            onMessagesChange([...updatedMessages, errorMsg]);
            return;
        }

        // Reset plan state for a new goal, but preserve it only when the user explicitly resumes the same run.
        const isResuming = planMode
            && hasResumableRun
            && (
                isContinueMessage
                || isAnsweringExplicitAsk
            );
        const nextRuntimeSnapshot = isResuming
            ? buildRuntimeSnapshot()
            : {
                ...buildRuntimeSnapshot(),
                planState: null,
                planStatus: 'idle' as AgentPlanPhase,
                activeRunId: undefined,
                activeTaskRun: null,
                compressedRunMemory: '',
                taskTodos: [],
                memoryFiles: [],
                compactState: null,
            };
        if (!isResuming) {
            setPlanState(null);
            planStateRef.current = null;
            setPlanStatus('idle');
            setActiveRunId(undefined);
            setActiveTaskRun(null);
            setCompressedRunMemory('');
            setTaskTodos([]);
            setMemoryFiles([]);
            setCompactState(null);
        }

        if (planMode) {
            // Agent V2 runtime lives in the main process and owns the full tool loop.
            // isLoading is reset by the agent-plan-update push event (done/stopped/paused)
            const profile = getSelectedProfile();
            setIsLoading(true);
            isLoadingRef.current = true;
            try {
                if (isResuming) {
                    await (window as any).electron?.agentPlanResume?.({
                        sessionId,
                        connectionId,
                        userInput: userMsg.content,
                        profile,
                        sshHost: host,
                        threadMessages: updatedMessages,
                        restoredRuntime: nextRuntimeSnapshot,
                    });
                } else {
                    setPlanState(null);
                    planStateRef.current = null;
                    setPlanStatus('generating');
                    await (window as any).electron?.agentPlanStart?.({
                        sessionId,
                        connectionId,
                        goal: userMsg.content,
                        profile,
                        sshHost: host,
                        threadMessages: updatedMessages,
                        restoredRuntime: nextRuntimeSnapshot,
                    });
                }
            } catch (err: any) {
                setIsLoading(false);
                isLoadingRef.current = false;
                const errorMsg: AgentMessage = {
                    id: `error-${Date.now()}`,
                    role: 'assistant',
                    content: `执行失败: ${err?.message || String(err)}`,
                    timestamp: Date.now(),
                    isError: true,
                };
                onMessagesChange([...updatedMessages, errorMsg]);
            }
        } else {
            setIsLoading(true);
            isLoadingRef.current = true;
            try {
                await runAgentLoop(updatedMessages);
            } finally {
                setIsLoading(false);
                isLoadingRef.current = false;
            }
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        const isSendTriggered = aiSendShortcut === 'ctrlEnter'
            ? (e.key === 'Enter' && e.ctrlKey)
            : (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey);

        if (isSendTriggered) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleStop = () => {
        isLoadingRef.current = false;
        setIsLoading(false);
        if (planMode) {
            (window as any).electron?.agentPlanStop?.({ sessionId });
        }
    };

    const starterPrompts = language === 'zh'
        ? ['部署这个 GitHub 项目到 3009 端口：https://github.com/owner/repo', '把我桌面上的项目部署到这台服务器', '检查这台服务器现在有什么异常', '把服务启动失败的原因查清并修复']
        : ['Deploy this GitHub project to port 3009: https://github.com/owner/repo', 'Deploy a local project to this server', 'Inspect what is unhealthy on this server', 'Find and fix why the service failed to start'];

    const visibleTodos = activeTaskRun?.taskTodos?.length ? activeTaskRun.taskTodos : taskTodos;
    const completedTodoCount = visibleTodos.filter((item) => item.status === 'completed').length;
    const activeTodo = visibleTodos.find((item) => item.status === 'in_progress') || visibleTodos.find((item) => item.status === 'pending');
    const activePlanStep = planState?.plan.find((step) => step.status === 'in_progress') || planState?.plan.find((step) => step.status === 'pending');
    const activeRoute = activeTaskRun?.activeHypothesisId
        ? activeTaskRun.hypotheses.find((item) => item.id === activeTaskRun.activeHypothesisId)?.kind || activeTaskRun.activeHypothesisId
        : undefined;
    const statusLabel = planStatus === 'executing'
        ? (language === 'zh' ? '执行中' : 'Running')
        : planStatus === 'generating'
            ? (language === 'zh' ? '分析计划' : 'Planning')
            : planStatus === 'paused'
                ? (language === 'zh' ? '等待继续' : 'Waiting')
                : planStatus === 'blocked'
                    ? (language === 'zh' ? '已阻塞' : 'Blocked')
                    : planStatus === 'waiting_approval'
                        ? (language === 'zh' ? '等待批准' : 'Waiting approval')
                        : planStatus === 'done'
                            ? (language === 'zh' ? '已完成' : 'Completed')
                            : planStatus === 'stopped'
                                ? (language === 'zh' ? '已停止' : 'Stopped')
                                : (language === 'zh' ? '待命' : 'Idle');
    const currentAgentAction = activeTaskRun?.currentAction
        || activeTodo?.content
        || activePlanStep?.description
        || (isLoading ? (language === 'zh' ? '正在分析任务上下文' : 'Analyzing task context') : '');
    const nextAgentAction = activeTaskRun?.checkpoint?.nextAction
        || activePlanStep?.description
        || activeTodo?.content
        || (planStatus === 'done'
            ? (language === 'zh' ? '任务已完成' : 'Task completed')
            : (language === 'zh' ? '等待生成下一步动作' : 'Waiting for the next action'));
    const lastFailure = activeTaskRun?.failureHistory?.length
        ? activeTaskRun.failureHistory[activeTaskRun.failureHistory.length - 1]
        : undefined;
    const lastProgressNote = activeTaskRun?.checkpoint?.lastProgressNote
        || lastFailure?.message
        || '';
    const showAgentState = planMode && (isLoading || planStatus !== 'idle' || Boolean(activeTaskRun) || visibleTodos.length > 0);
    const selectedBaseProfile = getBaseProfile();
    const selectedProfileModels = selectedBaseProfile
        ? Array.from(new Set([
            selectedBaseProfile.model,
            ...(selectedBaseProfile.models || []),
            AI_PROVIDER_CONFIGS[selectedBaseProfile.provider]?.defaultModel,
        ].map((model) => model?.trim()).filter((model): model is string => Boolean(model))))
        : [];
    const selectedModelLabel = agentModel || selectedBaseProfile?.model || (selectedBaseProfile ? AI_PROVIDER_CONFIGS[selectedBaseProfile.provider]?.defaultModel : '');
    const executedActionCount = messages.filter((message) => message.role === 'tool' && message.toolCall).length;
    const latestStrategy = activeTaskRun?.strategyHistory?.length
        ? activeTaskRun.strategyHistory[activeTaskRun.strategyHistory.length - 1]
        : undefined;
    const repoFinding = activeTaskRun?.repoAnalysis
        ? [
            activeTaskRun.repoAnalysis.repoName,
            activeTaskRun.repoAnalysis.framework,
            activeTaskRun.repoAnalysis.packaging,
        ].filter(Boolean).join(' · ')
        : '';
    const compactNote = (value: string, max = 180) => {
        const normalized = value.replace(/\s+/g, ' ').trim();
        return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
    };
    const agentProcessEntries = (() => {
        const entries: Array<{ type: 'thought' | 'status'; text: string }> = [];
        let commandCount = 0;

        for (const message of messages.slice(-28)) {
            if (message.role === 'tool' && message.toolCall) {
                commandCount += 1;
                continue;
            }

            const visibleThought = message.role === 'assistant'
                && !message.toolCall
                && !message.isError
                && message.content?.trim();
            if (!visibleThought) continue;

            if (commandCount > 0) {
                entries.push({
                    type: 'status',
                    text: language === 'zh' ? `Ran ${commandCount} commands` : `Ran ${commandCount} commands`,
                });
                commandCount = 0;
            }

            entries.push({
                type: 'thought',
                text: compactNote(message.content, 280),
            });
        }

        if (commandCount > 0) {
            entries.push({
                type: 'status',
                text: language === 'zh' ? `Ran ${commandCount} commands` : `Ran ${commandCount} commands`,
            });
        }

        if (!entries.length && currentAgentAction) {
            entries.push({
                type: 'thought',
                text: compactNote(currentAgentAction, 280),
            });
        }

        if (entries.length < 2 && latestStrategy) {
            entries.push({
                type: 'thought',
                text: compactNote(latestStrategy.summary || latestStrategy.reason, 280),
            });
        }

        if (entries.length < 2 && repoFinding) {
            entries.push({
                type: 'thought',
                text: language === 'zh'
                    ? `我已经定位到项目线索：${repoFinding}。`
                    : `I found project signals: ${repoFinding}.`,
            });
        }

        return entries.slice(-8);
    })();

    return (
        <div className={cn("flex h-full flex-col overflow-hidden bg-card", className)}>
            <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 pt-5">
                <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-5">
                {showAgentState && (
                    <div className="space-y-3 px-3 py-1">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Sparkles className="h-4 w-4 text-primary" />
                                {language === 'zh' ? '思考过程' : 'Working notes'}
                            </div>
                            <span className="text-xs font-medium text-primary">{statusLabel}</span>
                        </div>

                        <div className="space-y-4 text-[15px] leading-8 text-foreground/78">
                            {agentProcessEntries.map((entry, index) => (
                                <p
                                    key={`${entry.text}-${index}`}
                                    className={cn(
                                        'whitespace-pre-wrap',
                                        entry.type === 'status' && 'text-sm font-medium leading-6 text-muted-foreground/62'
                                    )}
                                >
                                    {entry.text}
                                </p>
                            ))}
                        </div>
                    </div>
                )}

                {messages.length === 0 && (
                    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-border bg-background px-6 py-8 text-muted-foreground">
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
                            <img src={logoUrl} alt="Reflex" className="h-7 w-7 rounded-md object-cover" />
                        </div>
                        <p className="mt-4 text-sm">{language === 'zh' ? '输入一个目标，AI 会继续接手执行。' : 'Give one goal and the AI will keep driving it.'}</p>
                        <div className="mt-4 flex max-w-2xl flex-wrap justify-center gap-3">
                            {starterPrompts.map(hint => (
                                <button
                                    key={hint}
                                    onClick={() => setInput(hint)}
                                    className="rounded-lg border border-border bg-card px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                >
                                    {hint}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((msg) => (
                    <MessageBubbleMemo key={msg.id} message={msg} />
                ))}

                {isLoading && messages[messages.length - 1]?.content === '' && (
                    <div className="rounded-xl border border-border/70 bg-background/55 px-4 py-3">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5">
                                {[0, 1, 2].map((index) => (
                                    <span
                                        key={index}
                                        className="h-1.5 w-1.5 rounded-full bg-primary"
                                        style={{ animation: `agentWaveDot 1.05s ease-in-out ${index * 0.14}s infinite` }}
                                    />
                                ))}
                            </div>
                            <div className="relative h-px w-28 overflow-hidden rounded-full bg-border/70">
                                <div
                                    className="absolute inset-y-0 w-16 rounded-full"
                                    style={{
                                        background: 'linear-gradient(90deg, transparent, hsl(var(--primary) / 0.75), transparent)',
                                        animation: 'agentThinkingLine 1.65s ease-in-out infinite',
                                    }}
                                />
                            </div>
                            <span className="text-xs text-muted-foreground/70">{t('agent.thinking')}</span>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Pending approval bar */}
            {pendingCommands.length > 0 && (
                <div className="mx-auto mb-3 w-full max-w-5xl rounded-xl border border-border bg-card px-4 py-3 shadow-none">
                    <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-foreground/78">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        <span>{pendingCommands.length} 个命令等待批准</span>
                    </div>
                    <div className="space-y-1">
                        {pendingCommands.map(({ cmd, msgId, aiMessages }, idx) => (
                            <div key={msgId} className="flex items-center gap-2 text-xs">
                                <code className="flex-1 bg-secondary/60 px-2 py-1 rounded font-mono text-[11px] truncate">{cmd}</code>
                                <button
                                    onClick={() => {
                                        setPendingCommands(prev => prev.filter((_, i) => i !== idx));
                                        resumeAfterApproval(cmd, msgId, aiMessages);
                                    }}
                                    className="rounded bg-primary/15 p-1 text-primary hover:bg-primary/25 transition-colors"
                                    title="批准执行"
                                    disabled={isLoading}
                                >
                                    <Check className="w-3 h-3" />
                                </button>
                                <button
                                    onClick={() => {
                                        const updatedMsgs = messages.map(m =>
                                            m.id === msgId ? { ...m, content: `已拒绝: ${cmd}`, toolCall: { ...m.toolCall!, status: 'executed' as const } } : m
                                        );
                                        onMessagesChange(updatedMsgs);
                                        setPendingCommands(prev => prev.filter((_, i) => i !== idx));
                                    }}
                                    className="rounded bg-destructive/15 p-1 text-destructive hover:bg-destructive/25 transition-colors"
                                    title="拒绝"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                        {pendingCommands.length > 1 && (
                            <div className="flex gap-1.5 mt-1">
                                <button
                                    onClick={async () => {
                                        const all = [...pendingCommands];
                                        setPendingCommands([]);
                                        // Execute first one and resume loop
                                        if (all.length > 0) {
                                            const first = all[0];
                                            resumeAfterApproval(first.cmd, first.msgId, first.aiMessages);
                                        }
                                    }}
                                    className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/25 transition-colors"
                                    disabled={isLoading}
                                >
                                    全部批准
                                </button>
                                <button
                                    onClick={() => {
                                        const updatedMsgs = messages.map(m => {
                                            const pc = pendingCommands.find(p => p.msgId === m.id);
                                            return pc ? { ...m, content: `已拒绝: ${pc.cmd}`, toolCall: { ...m.toolCall!, status: 'executed' as const } } : m;
                                        });
                                        onMessagesChange(updatedMsgs);
                                        setPendingCommands([]);
                                    }}
                                    className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/25 transition-colors"
                                >
                                    全部拒绝
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Input Area */}
            <div className="shrink-0 border-t border-border bg-card px-5 pb-4 pt-4">
                <div className="mx-auto max-w-5xl rounded-xl border border-border bg-background px-4 py-4">
                {/* Mode & Model selector bar 鈥?horizontal */}
                <div className="mb-3 flex items-center gap-2">
                    {/* Control Mode Selector */}
                    <div className="relative" ref={modeMenuRef}>
                        <button
                            onClick={() => { setShowModeMenu(!showModeMenu); setShowModelMenu(false); }}
                            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent"
                        >
                            {agentControlMode === 'auto' && <><Zap className="w-3 h-3 text-primary" />完全 AI 控制</>}
                            {agentControlMode === 'approval' && <><Shield className="w-3 h-3 text-amber-400" />批准模式</>}
                            {agentControlMode === 'whitelist' && <><ShieldCheck className="w-3 h-3 text-muted-foreground" />白名单模式</>}
                            <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                        {showModeMenu && (
                            <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[200px] rounded-md border border-border bg-popover py-1 shadow-sm">
                                {[
                                    { id: 'auto' as const, icon: <Zap className="w-3.5 h-3.5 text-primary" />, label: '完全 AI 控制', desc: '所有命令自动执行' },
                                    { id: 'approval' as const, icon: <Shield className="w-3.5 h-3.5 text-amber-400" />, label: '批准模式', desc: '每条命令都需要手动批准' },
                                    { id: 'whitelist' as const, icon: <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />, label: '白名单模式', desc: '白名单内命令自动执行' },
                                ].map(opt => (
                                    <button
                                        key={opt.id}
                                        onClick={() => { setAgentControlMode(opt.id); setShowModeMenu(false); }}
                                        className={cn(
                                            "w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-accent transition-colors",
                                            agentControlMode === opt.id && "bg-accent/50"
                                        )}
                                    >
                                        {opt.icon}
                                        <div className="flex flex-col">
                                            <span className="text-xs font-medium">{opt.label}</span>
                                            <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
                                        </div>
                                        {agentControlMode === opt.id && <Check className="w-3 h-3 text-primary ml-auto mt-0.5" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 鈹€鈹€ Model picker chip 鈹€鈹€ */}
                    <div className="relative" ref={modelMenuRef}>
                        <button
                            onClick={() => { setShowModelMenu(v => !v); setShowModeMenu(false); }}
                            className="flex max-w-[220px] items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent"
                            title={selectedModelLabel || 'Default model from settings'}
                        >
                            <Cpu className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">
                                {selectedModelLabel || selectedBaseProfile?.name || 'default'}
                            </span>
                            <ChevronDown className="w-2.5 h-2.5 flex-shrink-0 ml-0.5" />
                        </button>
                        {showModelMenu && (
                            <div className="absolute bottom-full left-0 z-50 mb-1 max-h-[320px] w-[260px] overflow-y-auto rounded-md border border-border bg-popover py-1.5 shadow-sm">
                                {/* Custom model input */}
                                <div className="px-3 pb-1.5 border-b border-border/40 mb-1">
                                    <input
                                        value={modelInput}
                                        onChange={e => setModelInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && modelInput.trim()) {
                                                setAgentModel(modelInput.trim());
                                                setAgentProfileId(selectedBaseProfile?.id || '');
                                                setShowModelMenu(false);
                                                e.preventDefault();
                                            }
                                        }}
                                        placeholder={language === 'zh' ? '自定义模型名称（Enter 确认）' : 'Custom model name (Enter to apply)'}
                                        className="w-full px-2 py-1.5 text-[11px] bg-secondary/50 rounded border border-border/40 focus:border-primary/50 outline-none"
                                        autoFocus
                                    />
                                </div>

                                {selectedBaseProfile && selectedProfileModels.length > 0 && (
                                    <div className="border-b border-border/40 px-3 py-2">
                                        <div className="mb-1.5 flex items-center justify-between">
                                            <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/50">
                                                {language === 'zh' ? '当前接口模型' : 'Current endpoint models'}
                                            </span>
                                            <span className="text-[9px] text-muted-foreground/45">{selectedBaseProfile.name}</span>
                                        </div>
                                        <div className="space-y-1">
                                            {selectedProfileModels.map((model) => {
                                                const isSelected = selectedModelLabel === model;
                                                return (
                                                    <button
                                                        key={`${selectedBaseProfile.id}:${model}`}
                                                        type="button"
                                                        onClick={() => {
                                                            setAgentProfileId(selectedBaseProfile.id);
                                                            setAgentModel(model);
                                                            setModelInput('');
                                                            setShowModelMenu(false);
                                                        }}
                                                        className={cn(
                                                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent',
                                                            isSelected && 'bg-accent/40 text-primary'
                                                        )}
                                                    >
                                                        <span className="min-w-0 flex-1 truncate font-mono">{model}</span>
                                                        {isSelected && <Check className="h-3 w-3 flex-shrink-0 text-primary" />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Configured profiles */}
                                {aiProfiles.length > 0 && (
                                    <div className="px-3 py-1.5">
                                        <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                                            {language === 'zh' ? '接口配置' : 'Endpoints'}
                                        </span>
                                    </div>
                                )}
                                {aiProfiles.map(profile => {
                                    const isSelected = (agentProfileId || activeProfileId) === profile.id && !agentModel;
                                    const providerInfo = AI_PROVIDER_CONFIGS[profile.provider];
                                    const modelName = profile.model || providerInfo?.defaultModel || '';
                                    const modelsCount = profile.models?.length || (modelName ? 1 : 0);
                                    return (
                                        <button
                                            key={profile.id}
                                            onClick={() => {
                                                setAgentProfileId(profile.id);
                                                setAgentModel(''); // use profile's own model
                                                setShowModelMenu(false);
                                            }}
                                            className={cn(
                                                'w-full text-left px-3 py-2 text-[11px] hover:bg-accent transition-colors',
                                                isSelected && 'text-primary bg-accent/40'
                                            )}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-semibold text-xs">{modelName}</span>
                                                {isSelected && <Check className="w-3 h-3 text-primary" />}
                                                {activeProfileId === profile.id && !isSelected && (
                                                    <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                                        {language === 'zh' ? '默认' : 'Default'}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                                                {profile.name} · {providerInfo?.displayName}
                                                {modelsCount > 1 && ` · ${modelsCount} ${language === 'zh' ? '个模型' : 'models'}`}
                                            </div>
                                        </button>
                                    );
                                })}

                                {/* Empty state */}
                                {aiProfiles.length === 0 && (
                                    <div className="px-3 py-3 text-[11px] text-muted-foreground/50 text-center">
                                        {language === 'zh' ? '请先在设置中添加 AI 配置' : 'Add an AI profile in Settings first'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="agent-chat-input relative overflow-hidden rounded-lg border border-border bg-card transition-colors focus-within:border-primary/40 focus-within:outline-none focus-within:ring-0">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={language === 'zh' ? '告诉 AI 你想完成什么…' : 'Tell the AI what you want to get done…'}
                        rows={1}
                        className="w-full resize-none overflow-hidden bg-transparent px-4 py-3 pr-12 text-sm text-foreground outline-none ring-0 transition-all placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 active:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isLoading}
                    />
                    {isLoading ? (
                        <button
                            onClick={handleStop}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-destructive/20 bg-destructive/10 p-2 text-destructive transition-colors hover:bg-destructive/20"
                            title={language === 'zh' ? '停止生成' : 'Stop'}
                            style={{ transformOrigin: 'center' }}
                        >
                            <Square className="w-4 h-4" />
                        </button>
                    ) : (
                        <button
                            onClick={handleSend}
                            disabled={!input.trim()}
                            className={cn(
                                "absolute right-2 top-1/2 -translate-y-1/2 rounded-md border p-2 transition-colors",
                                input.trim()
                                    ? "border-primary/25 bg-primary text-primary-foreground hover:bg-primary/90"
                                    : "border-border bg-muted/40 text-muted-foreground cursor-not-allowed"
                            )}
                            title={aiSendShortcut === 'ctrlEnter' ? '发送 (Ctrl+Enter)' : '发送 (Enter)'}
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    )}
                </div>
                <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-muted-foreground/52">
                    {aiSendShortcut === 'ctrlEnter'
                        ? (language === 'zh' ? 'Ctrl+Enter 发送 · Shift+Enter 换行' : 'Ctrl+Enter to send · Shift+Enter for newline')
                        : (language === 'zh' ? 'Enter 发送 · Shift+Enter 换行' : 'Enter to send · Shift+Enter for newline')}
                </div>
                </div>
            </div>
        </div>
    );
}

// Message Bubble Component 鈥?memo wrapper added below
function MessageBubble({ message }: { message: AgentMessage }) {
    const [expanded, setExpanded] = useState(true);
    const { language } = useTranslation();
    const toneStyles = {
        primary: {
            accent: 'hsl(var(--primary))',
            soft: 'hsl(var(--primary) / 0.10)',
            border: 'hsl(var(--primary) / 0.18)',
            glow: 'hsl(var(--primary) / 0.14)',
        },
        muted: {
            accent: 'hsl(var(--muted-foreground) / 0.82)',
            soft: 'hsl(var(--muted-foreground) / 0.08)',
            border: 'hsl(var(--border))',
            glow: 'hsl(var(--muted-foreground) / 0.10)',
        },
        warning: {
            accent: 'rgb(245 158 11)',
            soft: 'rgb(245 158 11 / 0.08)',
            border: 'rgb(245 158 11 / 0.16)',
            glow: 'rgb(245 158 11 / 0.14)',
        },
        danger: {
            accent: 'hsl(var(--destructive))',
            soft: 'hsl(var(--destructive) / 0.10)',
            border: 'hsl(var(--destructive) / 0.18)',
            glow: 'hsl(var(--destructive) / 0.14)',
        },
    } as const;

    const statusMeta = (() => {
        const content = (message.content || '').trim();
        if (message.role !== 'assistant' || !content || message.toolCall || message.reasoning || message.isStreaming) {
            return null;
        }

        if (/^Goal received\./i.test(content)) {
            return {
                icon: Target,
                label: language === 'zh' ? '目标已锁定' : 'Goal locked',
                tone: 'primary' as const,
            };
        }
        if (/^Built candidate routes:/i.test(content) || /^Repository signals are still limited\./i.test(content)) {
            return {
                icon: Brain,
                label: language === 'zh' ? '路线分析' : 'Route analysis',
                tone: 'muted' as const,
            };
        }
        if (/^Current route:/i.test(content)) {
            return {
                icon: ListChecks,
                label: language === 'zh' ? '当前路线' : 'Current route',
                tone: 'muted' as const,
            };
        }
        if (/^Task completed\. URL:/i.test(content) || /^FINAL_URL:/i.test(content)) {
            return {
                icon: CheckCircle2,
                label: language === 'zh' ? '任务完成' : 'Task completed',
                tone: 'primary' as const,
            };
        }
        if (/^Task is not finished yet\./i.test(content) || /^Current failure:/i.test(content)) {
            return {
                icon: ShieldAlert,
                label: language === 'zh' ? '任务暂停' : 'Task paused',
                tone: 'warning' as const,
            };
        }
        if (
            /^Route .*keeps failing/i.test(content)
            || /^Route .*still has repair space/i.test(content)
            || /^Route .*hit a failing pattern/i.test(content)
            || /^I still could not build a viable deployment route/i.test(content)
            || /^The first path looked like a container directory/i.test(content)
        ) {
            return {
                icon: AlertTriangle,
                label: language === 'zh' ? '策略调整' : 'Strategy shift',
                tone: 'warning' as const,
            };
        }
        return null;
    })();

    // Compact tool-call display (for both tool results and assistant tool-call requests)
    const renderToolCall = (toolCall: NonNullable<AgentMessage['toolCall']>, content?: string) => {
        const isPending = toolCall.status === 'pending';
        const isFailed = Boolean(message.isError);
        // Determine icon and color based on tool name
        const isRead = ['read_file', 'local_read_file', 'remote_read_file'].includes(toolCall.name);
        const isWrite = ['write_file', 'local_write_file', 'remote_write_file', 'local_replace_in_file', 'remote_replace_in_file', 'local_apply_patch', 'remote_apply_patch'].includes(toolCall.name);
        const isList = ['list_directory', 'local_list_directory', 'remote_list_directory'].includes(toolCall.name);
        const isDeploy = toolCall.name === 'deploy_project' || toolCall.name === 'resume_deploy_run';
        const isPackage = ['local_pack_archive', 'remote_extract_archive'].includes(toolCall.name);
        const isUpload = toolCall.name === 'remote_upload_file';
        const isDownload = toolCall.name === 'remote_download_file';
        const ToolIcon = isRead
            ? FileText
            : isWrite
                ? Pencil
                : isList
                    ? FolderOpen
                    : isPackage
                        ? Package
                        : isUpload || isDownload
                            ? Send
                            : isDeploy
                                ? Sparkles
                                : Terminal;
        const labelMap = {
            read_file: '读取文件',
            write_file: '写入文件',
            list_directory: '列出目录',
            local_read_file: '读取本地文件',
            local_write_file: '写入本地文件',
            local_replace_in_file: '局部修改本地文件',
            local_apply_patch: '补丁修改本地文件',
            local_list_directory: '本地目录',
            local_pack_archive: '本地打包归档',
            remote_read_file: '读取远程文件',
            remote_write_file: '写入远程文件',
            remote_replace_in_file: '局部修改远程文件',
            remote_apply_patch: '补丁修改远程文件',
            remote_list_directory: '远程目录',
            remote_upload_file: '上传文件',
            remote_extract_archive: '远端解压归档',
            remote_download_file: '下载文件',
            http_probe: isPending ? '探测地址中' : 'HTTP 探测完成',
            service_inspect: isPending ? '检查服务中' : '服务状态已读取',
            service_control: isPending ? '控制服务中' : '服务命令已执行',
            git_clone_remote: isPending ? '远程克隆中' : '远程克隆完成',
            git_fetch_remote: isPending ? '远程更新中' : '远程更新完成',
            local_exec: isPending ? '执行本地命令' : '本地命令完成',
            remote_exec: isPending ? '执行远程命令' : '远程命令完成',
            deploy_project: isPending ? '自动部署中' : (message.isError ? '部署失败' : '部署步骤已执行'),
            resume_deploy_run: isPending ? '恢复部署中' : (message.isError ? '恢复失败' : '恢复步骤已执行'),
            execute_ssh_command: isPending ? '等待批准' : '已执行',
        } as const;
        const label = labelMap[toolCall.name as keyof typeof labelMap] || labelMap.execute_ssh_command;
        const panelPalette = isFailed
            ? {
                accent: toneStyles.danger.accent,
                border: toneStyles.danger.border,
                glow: toneStyles.danger.glow,
                soft: toneStyles.danger.soft,
                chip: toneStyles.danger.soft,
            }
            : isPending
                ? {
                    accent: toneStyles.warning.accent,
                    border: toneStyles.warning.border,
                    glow: toneStyles.warning.glow,
                    soft: toneStyles.warning.soft,
                    chip: toneStyles.warning.soft,
                }
                : {
                    accent: toneStyles.primary.accent,
                    border: toneStyles.primary.border,
                    glow: toneStyles.primary.glow,
                    soft: toneStyles.primary.soft,
                    chip: toneStyles.primary.soft,
                };
        const typeAccent = isRead || isList || isDownload
            ? toneStyles.muted.accent
            : isFailed
                ? toneStyles.danger.accent
                : isPending
                    ? toneStyles.warning.accent
                    : toneStyles.primary.accent;
        const statusLabel = isFailed
            ? (language === 'zh' ? '失败' : 'Failed')
            : isPending
                ? (language === 'zh' ? '执行中' : 'Running')
                : (language === 'zh' ? '完成' : 'Done');
        const channelLabel = isDeploy
            ? (language === 'zh' ? 'Agent 路线' : 'Agent route')
            : isUpload || isDownload
                ? (language === 'zh' ? '文件传输' : 'File transfer')
                : toolCall.name.startsWith('remote_') || toolCall.name === 'execute_ssh_command'
                    ? (language === 'zh' ? '远程主机' : 'Remote host')
                    : toolCall.name.startsWith('local_')
                        ? (language === 'zh' ? '本地工作区' : 'Local workspace')
                        : (language === 'zh' ? '内部流程' : 'Internal flow');
        const actionKindLabel = isRead
            ? (language === 'zh' ? '读取 / 检查' : 'Read / inspect')
            : isWrite
                ? (language === 'zh' ? '写入 / 修改' : 'Write / patch')
                : isList
                    ? (language === 'zh' ? '目录巡检' : 'Directory scan')
                    : isPackage
                        ? (language === 'zh' ? '打包 / 解压' : 'Pack / extract')
                        : isUpload || isDownload
                            ? (language === 'zh' ? '传输 / 同步' : 'Transfer / sync')
                            : isDeploy
                                ? (language === 'zh' ? '自动编排' : 'Orchestration')
                                : (language === 'zh' ? '命令执行' : 'Command execution');
        const commandLabel = language === 'zh' ? '当前动作' : 'Current action';
        const outputLabel = language === 'zh' ? '执行输出' : 'Execution output';
        const detailLabel = language === 'zh' ? '动作说明' : 'Action note';
        const cleanCommand = toolCall.command.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{2B55}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '').trim();
        const outputContent = message.role === 'tool' && message.content ? message.content.trim() : '';

        return (
            <div className="space-y-2">
                {/* Reasoning/thinking block */}
                {message.reasoning && (
                    <div className="mx-1 overflow-hidden rounded-xl border border-border bg-card">
                        <details className="group">
                            <summary className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer select-none transition-colors hover:bg-accent/20">
                                <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-border bg-background">
                                    <Sparkles className="w-3.5 h-3.5" style={{ color: toneStyles.primary.accent }} />
                                </div>
                                <span className="font-medium text-foreground/72">思考过程</span>
                                <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground/60 group-open:rotate-90 transition-transform" />
                            </summary>
                            <div className="max-h-32 overflow-y-auto border-t border-border bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground/74 whitespace-pre-wrap">
                                {message.reasoning}
                            </div>
                        </details>
                    </div>
                )}

                <div
                    className="relative mx-1 overflow-hidden rounded-2xl border bg-card transition-colors duration-200 shadow-none"
                    style={{
                        borderColor: panelPalette.border,
                        background: 'hsl(var(--card))',
                    }}
                >
                    <div className="pointer-events-none absolute left-0 top-4 bottom-4 w-[2px] rounded-r-full" style={{ backgroundColor: panelPalette.accent }} />
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="relative flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-background/40"
                    >
                        <div
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background"
                            style={{ borderColor: panelPalette.border }}
                        >
                            <ToolIcon className="h-4 w-4" style={{ color: panelPalette.accent }} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span
                                    className="rounded-full border px-2.5 py-1 text-[10px] font-medium"
                                    style={{
                                        borderColor: panelPalette.border,
                                        backgroundColor: 'transparent',
                                        color: typeAccent,
                                    }}
                                >
                                    {label}
                                </span>
                                <span
                                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium"
                                    style={{
                                        borderColor: panelPalette.border,
                                        backgroundColor: 'hsl(var(--background) / 0.58)',
                                        color: panelPalette.accent,
                                    }}
                                >
                                    {isPending ? (
                                        <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: panelPalette.accent }} />
                                    ) : isFailed ? (
                                        <XCircle className="h-3 w-3" style={{ color: panelPalette.accent }} />
                                    ) : (
                                        <CheckCircle2 className="h-3 w-3" style={{ color: panelPalette.accent }} />
                                    )}
                                    {statusLabel}
                                </span>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                                <span>{channelLabel}</span>
                                <span className="text-muted-foreground/45">/</span>
                                <span>{actionKindLabel}</span>
                                <span className="text-muted-foreground/45">/</span>
                                <code className="font-mono text-[11px] text-foreground/58">{toolCall.name}</code>
                            </div>

                            {content && content.trim() && (
                                <div className="mt-3 text-sm leading-6 text-foreground/82">
                                    <MessageContent content={content} isUser={false} />
                                </div>
                            )}

                            <div className="mt-3 rounded-xl border border-border bg-background/48 px-3 py-3">
                                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    {commandLabel}
                                </div>
                                <code className="mt-2 block whitespace-pre-wrap break-all font-mono text-[12px] leading-6 text-foreground/92">
                                    {cleanCommand}
                                </code>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center pt-1 text-muted-foreground/65">
                            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground/70" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/70" />}
                        </div>
                    </button>

                    {expanded && (
                        <div className="border-t px-4 pb-4" style={{ borderColor: panelPalette.border, background: 'hsl(var(--background) / 0.18)' }}>
                            {outputContent ? (
                                <div className="mt-3 overflow-hidden rounded-xl border border-border bg-background/62">
                                    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
                                        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                            {outputLabel}
                                        </div>
                                        <div className="text-[10px] text-muted-foreground">
                                            {statusLabel}
                                        </div>
                                    </div>
                                    <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap px-3 py-3 font-mono text-[11px] leading-6 text-foreground/76 scrollbar-hide">
                                        {outputContent}
                                    </pre>
                                </div>
                            ) : (
                                <div className="mt-3 rounded-xl border border-dashed border-border bg-background/40 px-3 py-3 text-sm leading-6 text-muted-foreground">
                                    {isPending
                                        ? (language === 'zh' ? '动作正在执行，输出完成后会显示在这里。' : 'The action is still running. Output will appear here when ready.')
                                        : (language === 'zh' ? '这个动作没有返回额外输出。' : 'This action did not return extra output.')}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Tool result messages
    if (message.role === 'tool' && message.toolCall) {
        return renderToolCall(message.toolCall);
    }

    // Assistant messages that are tool-call wrappers (no empty bubble!)
    if (message.role === 'assistant' && message.toolCall) {
        return renderToolCall(message.toolCall, message.content);
    }

    // Skip completely empty assistant messages (thinking placeholders that weren't cleaned up)
    if (message.role === 'assistant' && !message.content && !message.isStreaming) {
        return null;
    }

    const isUser = message.role === 'user';
    const tokenInfo = !isUser && message.usage ? message.usage : null;

    if (!isUser && statusMeta) {
        const StatusIcon = statusMeta.icon;
        const palette = toneStyles[statusMeta.tone];
        return (
            <div className="flex">
                <div
                    className="relative max-w-[88%] overflow-hidden rounded-[16px] border border-border bg-card"
                    style={{
                        borderColor: palette.border,
                        background: `linear-gradient(180deg, ${palette.soft}, hsl(var(--card)))`,
                    }}
                >
                    <div
                        className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-r-full"
                        style={{ backgroundColor: palette.accent }}
                    />
                    <div className="relative px-4 py-3.5">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
                                <StatusIcon className="h-4 w-4" style={{ color: palette.accent }} />
                            </div>
                            <div className="min-w-0">
                                <div
                                    className="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                    style={{
                                        borderColor: palette.border,
                                        backgroundColor: palette.soft,
                                        color: palette.accent,
                                    }}
                                >
                                    {statusMeta.label}
                                </div>
                                <div className="mt-2 text-sm leading-relaxed text-foreground/86">
                                    <MessageContent content={message.content} isUser={false} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const bubbleStyle = message.isError
        ? {
            animation: 'agentSlideInUp 0.2s ease-out, agentShakeX 0.35s ease-in-out 0.2s',
        }
        : undefined;
    const userBubbleStyle = isUser
        ? {
            backgroundColor: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
            borderColor: 'hsl(var(--primary) / 0.28)',
            boxShadow: 'inset 0 1px 0 hsl(var(--primary-foreground) / 0.08)',
        }
        : undefined;

    return (
        <div className={cn("flex flex-col gap-1.5", isUser && "items-end")}>
            {/* Reasoning block for non-tool assistant messages */}
            {!isUser && message.reasoning && (
                <div className="mx-1 mb-1 max-w-[85%] overflow-hidden rounded-xl border border-border bg-card">
                    <details className="group">
                        <summary className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer select-none transition-colors hover:bg-accent/20">
                            <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-border bg-background">
                                <Sparkles className="w-3.5 h-3.5" style={{ color: toneStyles.primary.accent }} />
                            </div>
                            <span className="font-medium text-foreground/72">思考过程</span>
                            <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground/60 group-open:rotate-90 transition-transform duration-200" />
                        </summary>
                        <div className="overflow-hidden" style={{ animation: 'none' }}>
                            <div
                                className="max-h-32 overflow-y-auto border-t border-border bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground/74 whitespace-pre-wrap"
                                style={{ animation: 'agentAccordionIn 0.22s ease-out' }}
                            >
                                {message.reasoning}
                            </div>
                        </div>
                    </details>
                </div>
            )}
            <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
                {/* Avatar */}
                <div className={cn(
                    "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border",
                    isUser
                        ? "border-primary/20 bg-primary/12"
                        : "border-border bg-card"
                )}>
                    {isUser ? (
                        <User className="w-3.5 h-3.5 text-primary" />
                    ) : (
                        <img src={logoUrl} alt="Reflex" className="h-4 w-4 rounded-sm object-cover" />
                    )}
                </div>

                {/* Content */}
                <div
                    className={cn(
                        "max-w-[82%] rounded-lg px-4 py-3 text-sm leading-relaxed",
                        isUser
                            ? "rounded-tr-sm border"
                            : "rounded-tl-sm border border-border bg-card text-foreground",
                        message.isError && "border-destructive/30 bg-destructive/10"
                    )}
                    style={{
                        ...(userBubbleStyle || {}),
                        ...(bubbleStyle || {}),
                    }}
                >
                    {message.isStreaming && !message.content && (
                        <div className="py-3 min-w-[160px]">
                            {/* Shimmer skeleton rows */}
                            <div className="space-y-3">
                                {[90, 70, 50].map((w, i) => (
                                    <div key={i} className="relative h-3 rounded-full overflow-hidden" style={{ width: `${w}%`, background: 'hsl(var(--muted) / 0.65)' }}>
                                        <div className="absolute inset-0 rounded-full" style={{
                                            background: 'linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.22) 45%, transparent 100%)',
                                            animation: `agentShimmer 1.4s ease-in-out ${i * 0.18}s infinite`
                                        }} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <MessageContent content={message.content} isUser={isUser} isStreaming={message.isStreaming} />
                </div>
            </div>
            {/* Token usage badge */}
            {tokenInfo && (
                <div className="flex items-center gap-1.5 pl-10 text-[10px] text-muted-foreground/40 select-none">
                    <Cpu className="w-2.5 h-2.5" />
                    {message.modelUsed && <span className="font-mono opacity-70">{message.modelUsed.split('/').pop()}</span>}
                    <span className="opacity-50">·</span>
                    <span title="Prompt tokens">↑ {tokenInfo.promptTokens.toLocaleString()}</span>
                    <span title="Completion tokens">↓ {tokenInfo.completionTokens.toLocaleString()}</span>
                    <span className="opacity-50">=</span>
                    <span title="Total tokens" className="font-medium opacity-60">{tokenInfo.totalTokens.toLocaleString()} tok</span>
                </div>
            )}
        </div>
    );
}
// Memoized wrapper 鈥?skips re-render when chatWidth changes during drag resize
const MessageBubbleMemo = memo(MessageBubble);
// Simple markdown-ish content renderer
function MessageContent({ content, isUser, isStreaming }: { content: string; isUser: boolean; isStreaming?: boolean }) {
    if (!content && !isStreaming) return null;

    // Split by code blocks
    const parts = content.split(/(```[\s\S]*?```)/g);

    return (
        <div className="space-y-2">
            {parts.map((part, i) => {
                if (part.startsWith('```')) {
                    const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
                    if (match) {
                        const lang = match[1] || 'bash';
                        const code = match[2].trim();
                        return (
                            <div key={i} className="rounded-lg overflow-hidden my-2">
                                <div className="flex items-center justify-between px-3 py-1 bg-muted/55 text-[10px] text-muted-foreground">
                                    <span>{lang}</span>
                                </div>
                                <pre className="px-3 py-2 bg-background/80 text-xs font-mono overflow-x-auto">
                                    <code>{code}</code>
                                </pre>
                            </div>
                        );
                    }
                }

                // Render inline text with basic formatting
                const isLast = i === parts.length - 1;
                return (
                    <span key={i} className="whitespace-pre-wrap break-words">
                        {part.split('\n').map((line, j, arr) => (
                            <span key={j}>
                                {j > 0 && <br />}
                                {renderInlineMarkdown(line)}
                            </span>
                        ))}
                    </span>
                );
            })}
        </div>
    );
}

function renderInlineMarkdown(text: string) {
    // Bold
    const parts = text.split(/(\*\*[\s\S]*?\*\*)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        // Inline code
        const codeParts = part.split(/(`[^`]+`)/g);
        return codeParts.map((cp, j) => {
            if (cp.startsWith('`') && cp.endsWith('`')) {
                return (
                    <code key={`${i}-${j}`} className="px-1 py-0.5 rounded bg-muted/65 text-[12px] font-mono">
                        {cp.slice(1, -1)}
                    </code>
                );
            }
            return <span key={`${i}-${j}`}>{cp}</span>;
        });
    });
}







