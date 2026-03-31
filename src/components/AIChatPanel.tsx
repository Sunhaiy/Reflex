// AIChatPanel - Agent mode chat interface
import { useState, useRef, useEffect, KeyboardEvent, memo } from 'react';
import { Bot, User, Send, Loader2, Sparkles, ChevronDown, ChevronRight, Terminal, Square, Zap, Shield, ShieldCheck, Check, X, Cpu, FileText, FolderOpen, Brain, Pencil, ListChecks, ChevronUp, CheckCircle2, XCircle, Circle, Target, AlertTriangle, ShieldAlert } from 'lucide-react';
import { aiService } from '../services/aiService';
import { AI_SYSTEM_PROMPTS, AGENT_TOOLS, AIProviderProfile, AI_PROVIDER_CONFIGS, PlanState } from '../shared/aiTypes';
import { AgentPlanPhase, AgentSessionRuntime } from '../shared/types';
import { useSettingsStore } from '../store/settingsStore';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';

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
const LOCAL_PROJECT_PATH_RE = /[A-Za-z]:\\[^\r\n"'`<>|]+|\/(?:Users|home|opt|srv|var|tmp)[^\r\n"'`<>|]*/g;
const CONTINUE_INTENT_RE = /^(继续|继续处理|继续执行|继续部署|接着|接着做|再试一次|重试|continue|resume|retry)\s*[。.!！]?$/i;

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
    const [planCollapsed, setPlanCollapsed] = useState(true);
    const [compressedMemory, setCompressedMemory] = useState('');
    const [knownProjectPaths, setKnownProjectPaths] = useState<string[]>([]);
    const [activeDeployRunId, setActiveDeployRunId] = useState<string | undefined>(undefined);
    const [activeDeploySource, setActiveDeploySource] = useState<string | undefined>(undefined);
    const planStateRef = useRef<PlanState | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const modeMenuRef = useRef<HTMLDivElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const latestMessagesRef = useRef(messages);
    const onMessagesChangeRef = useRef(onMessagesChange);
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

    const buildRuntimeSnapshot = (): AgentSessionRuntime => ({
        planState,
        planStatus,
        contextWindow,
        compressedMemory,
        knownProjectPaths,
        agentModel,
        agentProfileId,
        activeDeployRunId,
        activeDeploySource,
    });

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

    // Restore per-chat execution state when switching sessions.
    useEffect(() => {
        const runtime = restoredRuntime || null;
        const nextPlanState = runtime?.planState || null;
        const nextPlanStatus = normalizeRestoredPlanStatus(runtime?.planStatus);

        setPlanState(nextPlanState);
        planStateRef.current = nextPlanState;
        setContextWindow(runtime?.contextWindow || null);
        setPlanStatus(nextPlanStatus);
        setCompressedMemory(runtime?.compressedMemory || '');
        setKnownProjectPaths(runtime?.knownProjectPaths || []);
        setAgentModel(runtime?.agentModel || '');
        setAgentProfileId(runtime?.agentProfileId || '');
        setActiveDeployRunId(runtime?.activeDeployRunId);
        setActiveDeploySource(runtime?.activeDeploySource);
        setPendingCommands([]);
        setIsLoading(false);
        isLoadingRef.current = false;
        setPlanCollapsed(true);
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
    }, [messages, planState, planStatus, contextWindow, compressedMemory, knownProjectPaths, agentModel, agentProfileId, activeDeployRunId, activeDeploySource]);

    useEffect(() => {
        onRuntimeChange?.(buildRuntimeSnapshot());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [planState, planStatus, contextWindow, compressedMemory, knownProjectPaths, agentModel, agentProfileId, activeDeployRunId, activeDeploySource]);

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
            ({ sessionId: eventSessionId, planState: ps, planPhase, contextWindow: ctxWindow, compressedMemory: nextCompressedMemory, knownProjectPaths: nextKnownProjectPaths, activeDeployRunId: nextDeployRunId, activeDeploySource: nextDeploySource }: any) => {
                if (eventSessionId !== sessionIdRef.current) return;
                setPlanState(ps);
                planStateRef.current = ps;
                setContextWindow(ctxWindow || null);
                setPlanStatus(planPhase);
                setCompressedMemory(nextCompressedMemory || '');
                setKnownProjectPaths(Array.isArray(nextKnownProjectPaths) ? nextKnownProjectPaths : []);
                setActiveDeployRunId(typeof nextDeployRunId === 'string' ? nextDeployRunId : undefined);
                setActiveDeploySource(typeof nextDeploySource === 'string' ? nextDeploySource : undefined);
                if (['done', 'stopped', 'paused', 'waiting_approval'].includes(planPhase)) {
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
                const selectedProfile = aiProfiles.find(p => p.id === (agentProfileId || activeProfileId));
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
    const getSelectedProfile = () => aiProfiles.find(p => p.id === (agentProfileId || activeProfileId));

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        const trimmedInput = input.trim();
        const isContinueMessage = CONTINUE_INTENT_RE.test(trimmedInput);

        if (!aiService.isConfigured()) {
            const errorMsg: AgentMessage = {
                id: Date.now().toString(),
                role: 'assistant',
                content: '请先在设置中配置 AI API Key',
                timestamp: Date.now(),
            };
            onMessagesChange([...messages, errorMsg]);
            return;
        }

        const userMsg: AgentMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: trimmedInput,
            timestamp: Date.now(),
        };

        const updatedMessages = [...messages, userMsg];
        onMessagesChange(updatedMessages);
        setInput('');

        // Reset plan state for a new goal, but preserve it when the user is continuing the same run.
        const isResuming = planMode
            && (
                ((planStatus === 'paused' || planStatus === 'waiting_approval') && planStateRef.current !== null)
                || (planStatus === 'stopped' && isContinueMessage && (planStateRef.current !== null || messages.length > 0))
            );
        if (!isResuming) {
            setPlanState(null);
            planStateRef.current = null;
            setPlanStatus('idle');
        }

        if (planMode) {
            // Agent V2 runtime lives in the main process and owns the full tool loop.
            // isLoading is reset by the agent-plan-update push event (done/stopped/paused)
            const profile = getSelectedProfile();
            setIsLoading(true);
            isLoadingRef.current = true;

            if (isResuming) {
                (window as any).electron?.agentPlanResume?.({
                    sessionId,
                    connectionId,
                    userInput: userMsg.content,
                    profile,
                    sshHost: host,
                    threadMessages: updatedMessages,
                    restoredRuntime: buildRuntimeSnapshot(),
                });
            } else {
                setPlanState(null);
                planStateRef.current = null;
                setPlanStatus('generating');
                (window as any).electron?.agentPlanStart?.({
                    sessionId,
                    connectionId,
                    goal: userMsg.content,
                    profile,
                    sshHost: host,
                    threadMessages: updatedMessages,
                    restoredRuntime: buildRuntimeSnapshot(),
                });
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

    const formatTokenCount = (count: number) => {
        if (count >= 1000) return `${Math.round(count / 1000)}k`;
        return `${count}`;
    };

    const contextWindowTitle = language === 'zh' ? '背景信息窗口' : 'Context Window';
    const contextWindowUsed = language === 'zh' ? '已用' : 'used';
    const contextWindowAutoCompressed = language === 'zh' ? '自动压缩' : 'Auto-compressed';
    const contextWindowTokens = language === 'zh' ? '标记' : 'tokens';

    const latestGoal = planState?.global_goal || [...messages].reverse().find(message => message.role === 'user')?.content || '';
    const starterPrompts = language === 'zh'
        ? ['把我桌面上的项目部署到这台服务器', '检查这台服务器现在有什么异常', '把服务启动失败的原因查清并修复']
        : ['Deploy a local project to this server', 'Inspect what is unhealthy on this server', 'Find and fix why the service failed to start'];
    const currentModelLabel = (() => {
        const profile = aiProfiles.find(pp => pp.id === (agentProfileId || activeProfileId));
        if (agentModel) return agentModel;
        if (profile?.model) return profile.model;
        if (profile) return profile.name;
        return language === 'zh' ? '默认模型' : 'Default Model';
    })();
    const runStatusLabel = planStatus === 'executing'
        ? (language === 'zh' ? '正在执行' : 'Executing')
        : planStatus === 'generating'
            ? (language === 'zh' ? '正在规划' : 'Planning')
            : planStatus === 'paused'
                ? (language === 'zh' ? '等待继续' : 'Paused')
                : planStatus === 'waiting_approval'
                    ? (language === 'zh' ? '等待批准' : 'Awaiting Approval')
                    : planStatus === 'done'
                        ? (language === 'zh' ? '执行完成' : 'Completed')
                        : planStatus === 'stopped'
                            ? (language === 'zh' ? '已停止' : 'Stopped')
                            : (language === 'zh' ? '待命中' : 'Standing By');

    return (
        <div className={cn("flex h-full flex-col overflow-hidden bg-card", className)}>
            <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 pt-5">
                <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-5">
                {messages.length === 0 && (
                    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-border bg-background px-6 py-8 text-muted-foreground">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card">
                            <Bot className="w-6 h-6 text-foreground/55" />
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
                    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
                        {/* Terminal blink cursor */}
                        <span
                            className="text-primary font-mono text-base leading-none"
                            style={{ animation: 'agentCursorBlink 0.8s step-end infinite' }}
                        >|</span>
                        {/* Shimmer skeleton bar */}
                        <div className="relative flex-1 h-2.5 rounded-full bg-muted/35 overflow-hidden max-w-[160px]">
                            <div
                                className="absolute inset-0 rounded-full"
                                style={{
                                    background: 'linear-gradient(90deg, transparent 0%, hsl(var(--primary)/0.3) 45%, transparent 100%)',
                                    animation: 'agentShimmer 1.4s ease-in-out infinite'
                                }}
                            />
                        </div>
                        <span className="text-xs text-muted-foreground/60 font-mono">{t('agent.thinking')}</span>
                    </div>
                )}

                <div ref={messagesEndRef} />
                </div>
            </div>

            {/* 鈹€鈹€ Plan Card (plan mode v2) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */}
            {planMode && planStatus !== 'idle' && (
                <div className="mx-auto w-full max-w-5xl px-5 pb-3">
                    <div
                        className="overflow-hidden rounded-lg border border-border bg-background"
                        style={{ animation: 'agentSlideInUp 0.22s ease-out' }}
                    >
                        {/* 鈹€鈹€ Header bar 鈹€鈹€ */}
                        <div className={cn(
                            "flex cursor-pointer select-none items-center gap-2 border-b border-border px-4 py-2.5",
                            planStatus === 'paused' ? "bg-yellow-500/8" : planStatus === 'waiting_approval' ? "bg-yellow-500/12" : "bg-muted/30",
                        )} onClick={() => setPlanCollapsed(v => !v)}>
                            <ListChecks className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
                                    <span className="text-[11px] font-semibold text-foreground/60 tracking-wide">执行计划</span>
                            {planStatus === 'generating' && (
                                <Loader2 className="w-3 h-3 text-primary/50 animate-spin ml-auto" />
                            )}
                            {planState && planStatus === 'executing' && (
                                <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono tabular-nums">
                                    {planState.plan.filter(s => s.status === 'completed' || s.status === 'skipped').length}
                                    <span className="opacity-40">/</span>
                                    {planState.plan.length}
                                </span>
                            )}
                            {planStatus === 'done' && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-400 ml-auto" />
                            )}
                            {planStatus === 'stopped' && (
                                            <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50">
                                                <Square className="w-2.5 h-2.5" />
                                                已停止
                                            </span>
                            )}
                            {planStatus === 'paused' && (
                                <span className="ml-auto flex items-center gap-1 text-[10px] text-yellow-500/80">
                                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500/70 animate-pulse" />
                                            等待你的回复
                                </span>
                            )}
                            {planStatus === 'waiting_approval' && (
                                <span className="ml-auto flex items-center gap-1.5 text-[10px] text-yellow-500 font-medium">
                                    <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                                    需要你批准高风险操作
                                </span>
                            )}
                            <span className="shrink-0 ml-1 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
                                {planCollapsed
                                    ? <ChevronUp className="w-3 h-3" />
                                    : <ChevronDown className="w-3 h-3" />
                                }
                            </span>
                        </div>

                        {/* 鈹€鈹€ Body (collapsible) 鈹€鈹€ */}
                        {!planCollapsed && (<>
                        {/* 鈹€鈹€ Generating skeleton 鈹€鈹€ */}
                        {planStatus === 'generating' && !planState && (
                            <div className="px-3 py-2.5 space-y-1.5">
                                {[80, 60, 70].map((w, i) => (
                                    <div key={i} className="relative h-2 rounded-full overflow-hidden bg-muted/30" style={{ width: `${w}%` }}>
                                        <div className="absolute inset-0 rounded-full" style={{
                                            background: 'linear-gradient(90deg, transparent 0%, hsl(var(--primary)/0.25) 50%, transparent 100%)',
                                            animation: `agentShimmer 1.4s ease-in-out ${i * 0.2}s infinite`
                                        }} />
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* 鈹€鈹€ Goal 鈹€鈹€ */}
                        {planState && (
                            <div className="flex items-start gap-2 px-3 py-2 border-b border-border/10">
                                <Target className="w-3 h-3 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
                                <span className="text-[11px] text-foreground/65 leading-snug">{planState.global_goal}</span>
                            </div>
                        )}

                        {/* 鈹€鈹€ Steps list 鈹€鈹€ */}
                        {planState && (
                            <div className="divide-y divide-border/10">
                                {planState.plan.map((step) => {
                                    const isCompleted = step.status === 'completed';
                                    const isFailed = step.status === 'failed';
                                    const isSkipped = step.status === 'skipped';
                                    // in_progress but stopped 鈫?treat visually as interrupted
                                    const isStopped = step.status === 'in_progress' && planStatus === 'stopped';
                                    const isPaused = step.status === 'in_progress' && planStatus === 'paused';
                                    const isWaitingApproval = step.status === 'in_progress' && planStatus === 'waiting_approval';
                                    const isActive = step.status === 'in_progress' && planStatus === 'executing';
                                    const StepIcon = isCompleted ? CheckCircle2 : isFailed ? XCircle : isWaitingApproval ? AlertTriangle : (isActive || isPaused) ? Loader2 : isStopped ? Square : Circle;
                                    const accentColor = isCompleted ? '#10b981' : isFailed ? '#ef4444' : isWaitingApproval ? '#eab308' : isActive ? 'hsl(var(--primary))' : isPaused ? '#eab308' : 'transparent';
                                    return (
                                        <div key={step.id} className={cn(
                                            "relative flex items-start gap-2 pl-4 pr-3 py-2 text-[11px] transition-colors",
                                            isActive && "bg-primary/5",
                                            isPaused && "bg-yellow-500/5",
                                            isWaitingApproval && "bg-yellow-500/8",
                                        )}>
                                            {/* Left accent strip */}
                                            <div
                                                className="absolute left-0 top-0 bottom-0 w-0.5"
                                                style={{ backgroundColor: accentColor }}
                                            />
                                            {/* Status icon */}
                                            <StepIcon className={cn(
                                                "w-3.5 h-3.5 flex-shrink-0 mt-0.5",
                                                isCompleted && "text-green-400",
                                                isFailed && "text-red-400",
                                                isActive && "text-primary animate-spin",
                                                isPaused && "text-yellow-500/70 animate-pulse",
                                                isWaitingApproval && "text-yellow-500 animate-pulse",
                                                isStopped && "text-muted-foreground/30",
                                                isSkipped && "text-muted-foreground/25",
                                                step.status === 'pending' && "text-muted-foreground/25",
                                            )} />
                                            <div className="flex-1 min-w-0">
                                                {/* Step description */}
                                                <span className={cn("leading-snug",
                                                    isCompleted && "text-muted-foreground/50 line-through",
                                                    isActive && "text-foreground font-medium",
                                                    isPaused && "text-yellow-500/70 font-medium",
                                                    isStopped && "text-muted-foreground/40",
                                                    isFailed && "text-red-400/70",
                                                    isSkipped && "text-muted-foreground/35 line-through",
                                                    step.status === 'pending' && "text-muted-foreground/55",
                                                )}>{step.description}</span>
                                                {/* Command preview */}
                                                {step.command && (isActive || isCompleted || isFailed || isStopped) && (
                                                    <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                                                        <Terminal className="w-2.5 h-2.5 text-muted-foreground/30 shrink-0" />
                                                        <code className="text-[10px] font-mono text-muted-foreground/35 truncate">{step.command}</code>
                                                    </div>
                                                )}
                                                {/* Result / error note */}
                                                {isCompleted && step.result && (
                                                    <p className="text-[10px] text-green-400/55 mt-0.5 leading-snug">{step.result}</p>
                                                )}
                                                {isFailed && step.error && (
                                                    <p className="text-[10px] text-red-400/55 mt-0.5 leading-snug">{step.error}</p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* 鈹€鈹€ Scratchpad (accumulated knowledge) 鈹€鈹€ */}
                        {planState?.scratchpad && (
                            <div className="flex items-start gap-1.5 px-3 py-2 border-t border-border/10">
                                <Brain className="w-2.5 h-2.5 text-muted-foreground/30 flex-shrink-0 mt-0.5" />
                                <p className="text-[10px] font-mono text-muted-foreground/35 leading-relaxed whitespace-pre-wrap">{planState.scratchpad}</p>
                            </div>
                        )}

                        {/* 鈹€鈹€ Paused: reply hint 鈹€鈹€ */}
                        {planStatus === 'paused' && (
                            <div className="flex items-center gap-1.5 px-3 py-2 border-t border-yellow-500/15 bg-yellow-500/5">
                                <ChevronRight className="w-3 h-3 text-yellow-500/60 flex-shrink-0" />
                                    <span className="text-[10px] text-yellow-500/70">在下方输入框回复后，计划会自动继续。</span>
                            </div>
                        )}

                        {/* 鈹€鈹€ Waiting approval: confirm hint 鈹€鈹€ */}
                        {planStatus === 'waiting_approval' && (
                            <div className="flex items-center gap-1.5 px-3 py-2 border-t border-yellow-500/20 bg-yellow-500/8">
                                <ShieldAlert className="w-3 h-3 text-yellow-500/70 flex-shrink-0" />
                                <span className="text-[10px] text-yellow-500/80">回复“确认执行”继续，或输入其他内容跳过这一步。</span>
                            </div>
                        )}

                        {/* 鈹€鈹€ Progress bar (executing only) 鈹€鈹€ */}
                        {planState && (planStatus === 'executing' || planStatus === 'stopped') && (
                            <div className="h-0.5 bg-muted/20 overflow-hidden">
                                <div
                                    className={cn("h-full transition-all duration-700", planStatus === 'stopped' ? "bg-muted-foreground/20" : "bg-primary/40")}
                                    style={{
                                        width: `${Math.round(
                                            (planState.plan.filter(s => s.status === 'completed' || s.status === 'skipped').length
                                                / planState.plan.length) * 100
                                        )}%`
                                    }}
                                />
                            </div>
                        )}
                        </>)}
                    </div>
                </div>
            )}

            {/* Pending approval bar */}
            {pendingCommands.length > 0 && (
                <div className="mx-auto mb-3 w-full max-w-5xl rounded-[20px] border border-yellow-500/20 bg-card px-4 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                    <div className="mb-1.5 text-[11px] font-medium text-yellow-600 dark:text-yellow-400">
                        {pendingCommands.length} 个命令等待批准
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
                                    className="p-1 rounded bg-green-500/20 text-green-600 hover:bg-green-500/30 transition-colors"
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
                                    className="p-1 rounded bg-red-500/20 text-red-600 hover:bg-red-500/30 transition-colors"
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
                                    className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-600 hover:bg-green-500/30 transition-colors"
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
                                    className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-600 hover:bg-red-500/30 transition-colors"
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
                            {agentControlMode === 'auto' && <><Zap className="w-3 h-3 text-green-500" />完全 AI 控制</>}
                            {agentControlMode === 'approval' && <><Shield className="w-3 h-3 text-yellow-500" />批准模式</>}
                            {agentControlMode === 'whitelist' && <><ShieldCheck className="w-3 h-3 text-blue-500" />白名单模式</>}
                            <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                        {showModeMenu && (
                            <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[200px] rounded-md border border-border bg-popover py-1 shadow-sm">
                                {[
                                    { id: 'auto' as const, icon: <Zap className="w-3.5 h-3.5 text-green-500" />, label: '完全 AI 控制', desc: '所有命令自动执行' },
                                    { id: 'approval' as const, icon: <Shield className="w-3.5 h-3.5 text-yellow-500" />, label: '批准模式', desc: '每条命令都需要手动批准' },
                                    { id: 'whitelist' as const, icon: <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />, label: '白名单模式', desc: '白名单内命令自动执行' },
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
                            title={agentModel || 'Default model from settings'}
                        >
                            <Cpu className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">
                                {(() => {
                                    const p = aiProfiles.find(pp => pp.id === (agentProfileId || activeProfileId));
                                    if (agentModel) return agentModel;
                                    if (p) return p.name;
                                    return 'default';
                                })()}
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
                                                setAgentProfileId(''); // use current active profile's API
                                                setShowModelMenu(false);
                                                e.preventDefault();
                                            }
                                        }}
                                        placeholder="自定义模型名称（Enter 确认）"
                                        className="w-full px-2 py-1.5 text-[11px] bg-secondary/50 rounded border border-border/40 focus:border-primary/50 outline-none"
                                        autoFocus
                                    />
                                </div>

                                {/* Configured profiles */}
                                {aiProfiles.length > 0 && (() => {
                                    const activeProfile = aiProfiles.find(p => p.id === (agentProfileId || activeProfileId));
                                    const currentModel = agentModel || activeProfile?.model || (activeProfile ? AI_PROVIDER_CONFIGS[activeProfile.provider]?.defaultModel : '');
                                    return (
                                        <div className="px-3 py-1.5 flex items-center justify-between">
                                            <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider">已配置</span>
                                            {currentModel && <span className="text-[10px] font-mono text-primary/70 truncate max-w-[140px]" title={currentModel}>{currentModel}</span>}
                                        </div>
                                    );
                                })()}
                                {aiProfiles.map(profile => {
                                    const isSelected = (agentProfileId || activeProfileId) === profile.id && !agentModel;
                                    const providerInfo = AI_PROVIDER_CONFIGS[profile.provider];
                                    const modelName = profile.model || providerInfo?.defaultModel || '';
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
                                                    <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">默认</span>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                                                {profile.name} · {providerInfo?.displayName}
                                            </div>
                                        </button>
                                    );
                                })}

                                {/* Empty state */}
                                {aiProfiles.length === 0 && (
                                    <div className="px-3 py-3 text-[11px] text-muted-foreground/50 text-center">
                                        请先在设置中添加 AI 配置
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="mb-3 overflow-hidden rounded-lg border border-border bg-card">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[10px] text-muted-foreground/75">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-medium text-foreground/75">{contextWindowTitle}</span>
                            {contextWindow ? (
                                <>
                                    <span>{Math.round(contextWindow.percentUsed)}% {contextWindowUsed}</span>
                                    <span>{contextWindowUsed} {formatTokenCount(contextWindow.promptTokens)} {contextWindowTokens} / {formatTokenCount(contextWindow.limitTokens)}</span>
                                    {contextWindow.compressionCount > 0 && (
                                        <span className="text-emerald-400/80">{contextWindowAutoCompressed} ×{contextWindow.compressionCount}</span>
                                    )}
                                </>
                            ) : (
                                <span>{language === 'zh' ? '当前上下文已就绪' : 'Context ready'}</span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">{currentModelLabel}</span>
                            <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-foreground/75">{runStatusLabel}</span>
                        </div>
                    </div>
                    {contextWindow && (
                        <div className="px-3 pb-2">
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
                                <div
                                    className={cn(
                                        "h-full transition-all duration-500",
                                        contextWindow.percentUsed >= 85 ? "bg-red-400/85" : contextWindow.percentUsed >= 70 ? "bg-yellow-400/85" : "bg-emerald-400/85",
                                    )}
                                    style={{ width: `${Math.min(100, Math.max(2, contextWindow.percentUsed))}%` }}
                                />
                            </div>
                        </div>
                    )}
                    {latestGoal && (
                        <div className="border-t border-border/45 px-3 py-2 text-[11px] text-foreground/72">
                            <span className="text-muted-foreground/65">{language === 'zh' ? '当前目标：' : 'Current goal: '}</span>
                            <span className="break-words leading-snug">{latestGoal}</span>
                        </div>
                    )}
                </div>

                <div className="relative overflow-hidden rounded-lg border border-border bg-card transition-colors focus-within:border-primary/40">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={language === 'zh' ? '告诉 AI 你想完成什么…' : 'Tell the AI what you want to get done…'}
                        rows={1}
                        className="w-full resize-none overflow-hidden bg-transparent px-4 py-3 pr-12 text-sm text-foreground transition-all placeholder:text-muted-foreground/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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

    // Compact tool-call display (for both tool results and assistant tool-call requests)
    const renderToolCall = (toolCall: NonNullable<AgentMessage['toolCall']>, content?: string) => {
        const isPending = toolCall.status === 'pending';
        // Determine icon and color based on tool name
        const isRead = ['read_file', 'local_read_file', 'remote_read_file'].includes(toolCall.name);
        const isWrite = ['write_file', 'local_write_file', 'remote_write_file'].includes(toolCall.name);
        const isList = ['list_directory', 'local_list_directory', 'remote_list_directory'].includes(toolCall.name);
        const isDeploy = toolCall.name === 'deploy_project' || toolCall.name === 'resume_deploy_run';
        const isFileOp = isRead || isWrite || isList;
        const ToolIcon = isRead ? FileText : isWrite ? Pencil : isList ? FolderOpen : isDeploy ? Sparkles : Terminal;
        // Color configs per tool type
        const colorMap = {
            read_file: { accent: '#3b82f6', light: 'rgba(59,130,246,0.12)', label: '读取文件' },
            write_file: { accent: '#f59e0b', light: 'rgba(245,158,11,0.12)', label: '写入文件' },
            list_directory: { accent: '#06b6d4', light: 'rgba(6,182,212,0.12)', label: '列出目录' },
            local_read_file: { accent: '#3b82f6', light: 'rgba(59,130,246,0.12)', label: '读取本地文件' },
            local_write_file: { accent: '#f59e0b', light: 'rgba(245,158,11,0.12)', label: '写入本地文件' },
            local_list_directory: { accent: '#06b6d4', light: 'rgba(6,182,212,0.12)', label: '本地目录' },
            remote_read_file: { accent: '#60a5fa', light: 'rgba(96,165,250,0.12)', label: '读取远程文件' },
            remote_write_file: { accent: '#fbbf24', light: 'rgba(251,191,36,0.12)', label: '写入远程文件' },
            remote_list_directory: { accent: '#22d3ee', light: 'rgba(34,211,238,0.12)', label: '远程目录' },
            local_exec: { accent: isPending ? '#eab308' : '#22c55e', light: isPending ? 'rgba(234,179,8,0.08)' : 'rgba(34,197,94,0.06)', label: isPending ? '执行本地命令' : '本地命令完成' },
            remote_exec: { accent: isPending ? '#eab308' : '#10b981', light: isPending ? 'rgba(234,179,8,0.08)' : 'rgba(16,185,129,0.06)', label: isPending ? '执行远程命令' : '远程命令完成' },
            deploy_project: { accent: isPending ? '#eab308' : (message.isError ? '#ef4444' : '#8b5cf6'), light: isPending ? 'rgba(234,179,8,0.08)' : (message.isError ? 'rgba(239,68,68,0.08)' : 'rgba(139,92,246,0.08)'), label: isPending ? '自动部署中' : (message.isError ? '部署失败' : '部署步骤已执行') },
            resume_deploy_run: { accent: isPending ? '#eab308' : (message.isError ? '#ef4444' : '#8b5cf6'), light: isPending ? 'rgba(234,179,8,0.08)' : (message.isError ? 'rgba(239,68,68,0.08)' : 'rgba(139,92,246,0.08)'), label: isPending ? '恢复部署中' : (message.isError ? '恢复失败' : '恢复步骤已执行') },
            execute_ssh_command: { accent: isPending ? '#eab308' : '#10b981', light: isPending ? 'rgba(234,179,8,0.08)' : 'rgba(16,185,129,0.06)', label: isPending ? '等待批准' : '已执行' },
        };
        const colors = colorMap[toolCall.name as keyof typeof colorMap] || colorMap.execute_ssh_command;
        const statusLabel = isFileOp ? (isPending ? '执行中' : '完成') : colors.label;

        return (
            <div className="space-y-1.5">
                {/* Reasoning/thinking block */}
                {message.reasoning && (
                    <div className="mx-1 rounded-lg border border-purple-500/20 bg-purple-500/5 overflow-hidden">
                        <details className="group">
                            <summary className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-purple-500/10 transition-colors">
                                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                                <span className="text-purple-400/80 font-medium">思考过程</span>
                                <ChevronRight className="w-3 h-3 text-purple-400/50 ml-auto group-open:rotate-90 transition-transform" />
                            </summary>
                            <div className="px-3 py-2 border-t border-purple-500/10 text-[11px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                                {message.reasoning}
                            </div>
                        </details>
                    </div>
                )}
                {/* If the assistant included text explanation, show it above */}
                {content && content.trim() && (
                    <div className="flex gap-3">
                        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-card shadow-sm">
                            <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div className="max-w-[82%] rounded-lg rounded-tl-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground">
                            <MessageContent content={content} isUser={false} />
                        </div>
                    </div>
                )}
                {/* 鈹€鈹€ Tool block with accent strip 鈹€鈹€ */}
                <div
                    className="mx-1 overflow-hidden rounded-lg border border-border bg-card transition-colors duration-200"
                    style={{
                        borderColor: `${colors.accent}20`,
                    }}
                >
                    {/* Command header with left accent strip */}
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="flex w-full items-center gap-2 px-4 py-3 text-xs transition-colors hover:bg-accent/45"
                        style={{ background: `linear-gradient(90deg, ${colors.accent}08, transparent)` }}
                    >
                        {/* Left accent strip */}
                        <div
                            className="w-0.5 h-5 rounded-full shrink-0 -ml-1"
                            style={{ backgroundColor: colors.accent }}
                        />
                        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground/60" /> : <ChevronRight className="w-3 h-3 text-muted-foreground/60" />}
                        <ToolIcon className="w-3.5 h-3.5 shrink-0" style={{ color: colors.accent }} />
                        <code className="font-mono text-[11px] text-foreground/90 truncate flex-1 text-left">{toolCall.command.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{2B55}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '').trim()}</code>
                        {isPending ? (
                            <span className="flex items-center gap-1.5 ml-2 shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: colors.accent }} />
                                <span className="text-[10px] font-medium" style={{ color: `${colors.accent}cc` }}>{statusLabel}</span>
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 ml-2 shrink-0">
                                <Check className="w-3 h-3" style={{ color: colors.accent }} />
                                <span className="text-[10px] font-medium" style={{ color: `${colors.accent}cc` }}>{statusLabel}</span>
                            </span>
                        )}
                    </button>
                    {/* Output area */}
                    {expanded && message.role === 'tool' && message.content && (
                        <div className="border-t bg-muted/30" style={{ borderColor: `${colors.accent}15` }}>
                            <pre className="px-3 py-2 text-[11px] text-muted-foreground/70 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed scrollbar-hide">
                                {message.content}
                            </pre>
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

    return (
        <div className={cn("flex flex-col gap-1.5", isUser && "items-end")}>
            {/* Reasoning block for non-tool assistant messages */}
            {!isUser && message.reasoning && (
                <div className="mx-1 mb-1 rounded-lg border border-purple-500/20 bg-purple-500/5 overflow-hidden max-w-[85%]">
                    <details className="group">
                        <summary className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-purple-500/10 transition-colors">
                            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                            <span className="text-purple-400/80 font-medium">思考过程</span>
                            <ChevronRight className="w-3 h-3 text-purple-400/50 ml-auto group-open:rotate-90 transition-transform duration-200" />
                        </summary>
                        <div className="overflow-hidden" style={{ animation: 'none' }}>
                            <div
                                className="px-3 py-2 border-t border-purple-500/10 text-[11px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto"
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
                        ? "border-primary/20 bg-gradient-to-br from-primary/30 to-primary/10"
                        : "border-border/60 bg-card shadow-sm"
                )}>
                    {isUser ? (
                        <User className="w-3.5 h-3.5 text-primary" />
                    ) : (
                        <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                </div>

                {/* Content */}
                <div
                    className={cn(
                        "max-w-[82%] rounded-lg px-4 py-3 text-sm leading-relaxed",
                        isUser
                            ? "rounded-tr-sm border border-primary/20 bg-primary text-primary-foreground"
                            : "rounded-tl-sm border border-border bg-card text-foreground",
                        message.isError && "border-red-500/30 bg-red-500/10"
                    )}
                    style={message.isError ? {
                        animation: 'agentSlideInUp 0.2s ease-out, agentShakeX 0.35s ease-in-out 0.2s'
                    } : undefined}
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







