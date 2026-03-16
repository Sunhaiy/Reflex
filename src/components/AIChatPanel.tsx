// AIChatPanel - Agent mode chat interface
import { useState, useRef, useEffect, KeyboardEvent, memo } from 'react';
import { Bot, User, Send, Loader2, Sparkles, ChevronDown, ChevronRight, Terminal, Square, Zap, Shield, ShieldCheck, Check, X, Cpu, FileText, FolderOpen, Brain, Pencil, ListChecks, ChevronUp } from 'lucide-react';
import { aiService } from '../services/aiService';
import { AI_SYSTEM_PROMPTS, AGENT_TOOLS, AIProviderProfile, AI_PROVIDER_CONFIGS } from '../shared/aiTypes';
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
    profileId: string;           // SSHConnection.id — for session binding
    host: string;                // displayed server hostname
    messages: AgentMessage[];
    onMessagesChange: (messages: AgentMessage[]) => void;
    onExecuteCommand: (command: string) => void;
    sessionId: string;           // current session ID managed by parent
    onSaveComplete?: () => void; // notifies sidebar to refresh
    className?: string;
}

export function AIChatPanel({ connectionId, profileId, host, messages, onMessagesChange, onExecuteCommand, sessionId, onSaveComplete, className }: AIChatPanelProps) {
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [pendingCommands, setPendingCommands] = useState<{ cmd: string; msgId: string; aiMessages: any[] }[]>([]);
    const [showModeMenu, setShowModeMenu] = useState(false);
    const [showModelMenu, setShowModelMenu] = useState(false);
    const [agentModel, setAgentModel] = useState('');         // '' = use profile's default model
    const [agentProfileId, setAgentProfileId] = useState(''); // '' = use active profile
    const [modelInput, setModelInput] = useState('');          // text field in picker
    // ── Plan Mode state ───────────────────────────────────────────────────────
    const [planMode, setPlanMode] = useState(false);
    const [currentPlan, setCurrentPlan] = useState<{ goal: string; steps: string[] } | null>(null);
    const [planStatus, setPlanStatus] = useState<'idle' | 'generating' | 'waiting' | 'executing' | 'done'>('idle');
    const [currentStep, setCurrentStep] = useState(-1);
    const [toolCallCount, setToolCallCount] = useState(0);
    const [budgetPaused, setBudgetPaused] = useState(false);
    const [pendingResumeMessages, setPendingResumeMessages] = useState<AgentMessage[] | null>(null);
    const BUDGET_PER_STEP = 5;
    const toolCallCountRef = useRef(0);
    const currentPlanRef = useRef<{ goal: string; steps: string[] } | null>(null);
    const currentStepRef = useRef(-1);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const modeMenuRef = useRef<HTMLDivElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const latestMessagesRef = useRef(messages);
    const { aiSendShortcut, agentControlMode, setAgentControlMode, agentWhitelist, aiProfiles, activeProfileId } = useSettingsStore();
    const { t } = useTranslation();
    const agentControlModeRef = useRef(agentControlMode);
    const agentWhitelistRef = useRef(agentWhitelist);
    const isLoadingRef = useRef(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionIdRef = useRef(sessionId);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

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

    // ── Auto-save session to store (debounced 800ms) ──────────────────────────
    useEffect(() => {
        if (messages.length === 0) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            const sid = sessionIdRef.current;
            if (!sid || !profileId) return;
            // Auto-generate title from last user message (most recent topic)
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            const title = lastUser
                ? lastUser.content.replace(/\s+/g, ' ').slice(0, 40) + (lastUser.content.length > 40 ? '…' : '')
                : t('agent.newSession');
            const session = {
                id: sid,
                title,
                profileId,
                host,
                messages,
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
    }, [messages]);

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
                    // Show command in terminal display (NOT PTY stdin — no pager, no double-exec)
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
                        // reconnect threw — continue anyway, sshExec will fail again if truly down
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
    const buildChatMessages = (msgs: AgentMessage[]): any[] => {
        const chatMsgs: any[] = [
            { role: 'system', content: AI_SYSTEM_PROMPTS.agent },
        ];
        // Apply sliding window — take last CONTEXT_WINDOW messages
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
                    // Strip tool_calls — treat as plain text message
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

        while (true) {
            if (!isLoadingRef.current) break; // stopped by user

            // ── Budget check (plan mode) ──
            if (planMode && toolCallCountRef.current >= BUDGET_PER_STEP) {
                setBudgetPaused(true);
                setPendingResumeMessages(loopMessages);
                setIsLoading(false);
                isLoadingRef.current = false;
                return;
            }

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
                const chatMessages = buildChatMessages(loopMessages);
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
                // Case 1: AI returned text (no tool call) — done
                if (!response.toolCalls || response.toolCalls.length === 0) {
                    const assistantMsg: AgentMessage = {
                        id: `asst-${Date.now()}`,
                        role: 'assistant',
                        content: response.content || '（无回复）',
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
                    // Queue for approval — pause the loop
                    setPendingCommands(prev => [...prev, {
                        cmd: execCmd,
                        msgId: toolCallMsgId,
                        aiMessages: loopMessages, // snapshot for resuming
                    }]);
                    break; // Loop pauses — will resume when user approves
                }

                // Execute immediately
                // Increment budget counter in plan mode and advance step tracker
                if (planMode) {
                    toolCallCountRef.current += 1;
                    setToolCallCount(toolCallCountRef.current);
                    // Distribute steps evenly across tool calls:
                    // Each step gets (total_budget / step_count) calls
                    const plan = currentPlanRef.current;
                    if (plan && plan.steps.length > 0) {
                        const callsPerStep = Math.max(1, Math.ceil(BUDGET_PER_STEP / plan.steps.length));
                        const stepIdx = Math.min(
                            Math.floor((toolCallCountRef.current - 1) / callsPerStep),
                            plan.steps.length - 1
                        );
                        if (stepIdx !== currentStepRef.current) {
                            currentStepRef.current = stepIdx;
                            setCurrentStep(stepIdx);
                        }
                    }
                }
                const result = await execCommand(execCmd);

                // Update assistant message status to executed
                loopMessages = loopMessages.map(m =>
                    m.id === toolCallMsgId
                        ? { ...m, toolCall: { ...m.toolCall!, status: 'executed' as const } }
                        : m
                );

                // Add tool result message
                const resultContent = result.stderr
                    ? `[exit ${result.exitCode}]\n${result.stdout}\n[stderr]\n${result.stderr}`
                    : `[exit ${result.exitCode}]\n${result.stdout}`;

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

                // Continue loop — AI will analyze the result
                await new Promise(r => setTimeout(r, 200)); // small delay

            } catch (err: any) {
                const errorMsg: AgentMessage = {
                    id: `error-${Date.now()}`,
                    role: 'assistant',
                    content: `❌ 错误: ${err.message}`,
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
            // Immediately update the current UI messages to show "已执行" status
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
            const resultContent = result.stderr
                ? `[exit ${result.exitCode}]\n${result.stdout}\n[stderr]\n${result.stderr}`
                : `[exit ${result.exitCode}]\n${result.stdout}`;

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
                content: `❌ 执行失败: ${err.message}`,
                timestamp: Date.now(),
                isError: true,
            };
            onMessagesChange([...latestMessagesRef.current, errorMsg]);
        } finally {
            setIsLoading(false);
            isLoadingRef.current = false;
        }
    };

    // ── Generate a plan from user input (plan mode) ───────────────────────────
    // Returns the parsed plan, or null on failure.
    const generatePlan = async (userInput: string): Promise<{ goal: string; steps: string[] } | null> => {
        setPlanStatus('generating');
        const selectedProfile = aiProfiles.find(p => p.id === (agentProfileId || activeProfileId));
        try {
            const response = await aiService.completeWithTools({
                messages: [
                    { role: 'system', content: AI_SYSTEM_PROMPTS.agentPlan },
                    { role: 'user', content: userInput },
                ],
                tools: [],
                temperature: 0.3,
                overrideModel: agentModel || undefined,
                overrideProfile: selectedProfile || undefined,
            });
            // Strip markdown code fences if present
            const raw = (response.content || '').trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
            const plan = JSON.parse(raw) as { goal: string; steps: string[] };
            if (!plan.goal || !Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error('invalid plan');
            return plan;
        } catch {
            return null;
        }
    };


    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        if (!aiService.isConfigured()) {
            const errorMsg: AgentMessage = {
                id: Date.now().toString(),
                role: 'assistant',
                content: '⚠️ 请先在设置中配置 AI API Key',
                timestamp: Date.now(),
            };
            onMessagesChange([...messages, errorMsg]);
            return;
        }

        const userMsg: AgentMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
            timestamp: Date.now(),
        };

        const updatedMessages = [...messages, userMsg];
        onMessagesChange(updatedMessages);
        setInput('');

        // Reset plan state for new message
        setCurrentPlan(null);
        currentPlanRef.current = null;
        setPlanStatus('idle');
        setCurrentStep(-1);
        currentStepRef.current = -1;
        toolCallCountRef.current = 0;
        setToolCallCount(0);
        setBudgetPaused(false);
        setPendingResumeMessages(null);

        if (planMode) {
            // Plan mode: generate plan, then auto-execute immediately
            setIsLoading(true);
            isLoadingRef.current = true;
            try {
                const plan = await generatePlan(userMsg.content);
                if (plan) {
                    // Plan generated — start executing right away
                    setCurrentPlan(plan);
                    currentPlanRef.current = plan;
                    setPlanStatus('executing');
                    setCurrentStep(0);
                    currentStepRef.current = 0;
                    toolCallCountRef.current = 0;
                    setToolCallCount(0);
                    await runAgentLoop(updatedMessages);
                    setPlanStatus('done');
                } else {
                    // Plan generation failed — fall back to direct execution
                    setPlanStatus('idle');
                    await runAgentLoop(updatedMessages);
                }
            } finally {
                setIsLoading(false);
                isLoadingRef.current = false;
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
    };

    return (
        <div className={cn("flex flex-col h-full", className)}>
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60 gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                            <Bot className="w-6 h-6 text-primary/60" />
                        </div>
                        <p className="text-sm">输入指令，AI 将自动操作服务器</p>
                        <div className="flex flex-wrap gap-2 mt-2 max-w-sm justify-center">
                            {['查看磁盘空间', '列出运行中的服务', '查看系统负载'].map(hint => (
                                <button
                                    key={hint}
                                    onClick={() => setInput(hint)}
                                    className="px-3 py-1.5 rounded-full text-xs bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors border border-border/50"
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
                    <div className="flex items-center gap-3 px-4">
                        {/* Terminal blink cursor */}
                        <span
                            className="text-primary font-mono text-base leading-none"
                            style={{ animation: 'agentCursorBlink 0.8s step-end infinite' }}
                        >█</span>
                        {/* Shimmer skeleton bar */}
                        <div className="relative flex-1 h-2.5 rounded-full bg-muted/40 overflow-hidden max-w-[140px]">
                            <div
                                className="absolute inset-0 rounded-full"
                                style={{
                                    background: 'linear-gradient(90deg, transparent 0%, hsl(var(--primary)/0.3) 45%, transparent 100%)',
                                    animation: 'agentShimmer 1.4s ease-in-out infinite'
                                }}
                            />
                        </div>
                        <span className="text-xs text-muted-foreground/60 font-mono">thinking...</span>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* ── Plan Card (plan mode) ────────────────────────────────────── */}
            {planMode && (planStatus === 'generating' || planStatus === 'executing') && (
                <div className="border-t border-border mx-3 mt-0 mb-0">
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 mt-2 mb-1 space-y-2">
                        {/* Header */}
                        <div className="flex items-center gap-2">
                            <ListChecks className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                            <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider">执行计划</span>
                            {planStatus === 'generating' && (
                                <Loader2 className="w-3 h-3 text-blue-400 animate-spin ml-auto" />
                            )}
                            {planStatus === 'executing' && currentPlan && (
                                <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                                    {Math.min(currentStep + 1, currentPlan.steps.length)}/{currentPlan.steps.length} 步
                                </span>
                            )}
                        </div>

                        {/* Goal */}
                        {currentPlan && (
                            <p className="text-[11px] text-foreground/80 leading-snug">
                                🎯 {currentPlan.goal}
                            </p>
                        )}

                        {/* Steps list */}
                        {planStatus === 'generating' && !currentPlan && (
                            <p className="text-[10px] text-muted-foreground animate-pulse">正在生成执行计划…</p>
                        )}
                        {currentPlan && (
                            <div className="space-y-1">
                                {currentPlan.steps.map((step, idx) => {
                                    const isDone = planStatus === 'executing' && idx < currentStep;
                                    const isCurrent = planStatus === 'executing' && idx === currentStep;
                                    const isPending = idx > currentStep || planStatus === 'waiting';
                                    return (
                                        <div key={idx} className={cn(
                                            "flex items-start gap-2 text-[11px] rounded px-1.5 py-0.5 transition-colors",
                                            isCurrent && "bg-blue-500/10",
                                        )}>
                                            <span className={cn(
                                                "mt-0.5 w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold",
                                                isDone && "bg-green-500/20 text-green-400",
                                                isCurrent && "bg-blue-500/30 text-blue-300",
                                                isPending && "bg-secondary/60 text-muted-foreground",
                                            )}>
                                                {isDone ? '✓' : isCurrent ? '▶' : idx + 1}
                                            </span>
                                            <span className={cn(
                                                "leading-snug",
                                                isDone && "text-muted-foreground line-through",
                                                isCurrent && "text-foreground font-medium",
                                                isPending && "text-muted-foreground",
                                            )}>{step}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Overall progress bar (executing) */}
                        {planStatus === 'executing' && currentPlan && (
                            <div className="h-1 rounded-full bg-secondary/40 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-blue-500 transition-all duration-500"
                                    style={{
                                        width: `${Math.min(
                                            ((currentStep + 1) / currentPlan.steps.length) * 100,
                                            100
                                        )}%`
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Pending approval bar */}
            {pendingCommands.length > 0 && (
                <div className="border-t border-border px-3 py-2 bg-yellow-500/5">
                    <div className="text-[11px] font-medium text-yellow-600 dark:text-yellow-400 mb-1.5">⏳ {pendingCommands.length} 个命令等待批准</div>
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
            <div className="border-t border-border p-3 bg-background shrink-0">
                {/* Mode & Model selector bar — horizontal */}
                <div className="flex items-center gap-2 mb-2">
                    {/* Plan Mode toggle */}
                    <button
                        onClick={() => setPlanMode(v => !v)}
                        title={planMode ? '关闭计划模式' : '开启计划模式：AI 先生成执行计划，你确认后再执行'}
                        className={cn(
                            "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors border",
                            planMode
                                ? "bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30"
                                : "bg-secondary/50 hover:bg-secondary/80 text-muted-foreground border-border/40"
                        )}
                    >
                        <ListChecks className="w-3 h-3" />
                        计划模式
                    </button>
                    {/* Control Mode Selector */}
                    <div className="relative" ref={modeMenuRef}>
                        <button
                            onClick={() => { setShowModeMenu(!showModeMenu); setShowModelMenu(false); }}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium bg-secondary/50 hover:bg-secondary/80 text-muted-foreground transition-colors border border-border/40"
                        >
                            {agentControlMode === 'auto' && <><Zap className="w-3 h-3 text-green-500" />完全 AI 控制</>}
                            {agentControlMode === 'approval' && <><Shield className="w-3 h-3 text-yellow-500" />批准模式</>}
                            {agentControlMode === 'whitelist' && <><ShieldCheck className="w-3 h-3 text-blue-500" />白名单模式</>}
                            <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                        {showModeMenu && (
                            <div className="absolute bottom-full left-0 mb-1 bg-popover border border-border rounded-lg shadow-lg py-1 z-50 min-w-[200px]">
                                {[
                                    { id: 'auto' as const, icon: <Zap className="w-3.5 h-3.5 text-green-500" />, label: '完全 AI 控制', desc: '所有命令自动执行' },
                                    { id: 'approval' as const, icon: <Shield className="w-3.5 h-3.5 text-yellow-500" />, label: '批准模式', desc: '每条命令需要手动批准' },
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

                    {/* ── Model picker chip ── */}
                    <div className="relative" ref={modelMenuRef}>
                        <button
                            onClick={() => { setShowModelMenu(v => !v); setShowModeMenu(false); }}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-secondary/50 hover:bg-secondary/80 text-muted-foreground transition-colors border border-border/40 max-w-[200px]"
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
                            <div className="absolute bottom-full left-0 mb-1 bg-popover border border-border rounded-lg shadow-lg py-1.5 z-50 w-[260px] max-h-[320px] overflow-y-auto">
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
                                        placeholder="自定义模型名称… (Enter 确认)"
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

                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="告诉 AI 你想做什么..."
                        rows={1}
                        className="w-full resize-none overflow-hidden rounded-md border border-input bg-background/50 px-4 py-2.5 pr-12 text-sm transition-all placeholder:text-muted-foreground/50 hover:bg-accent/30 hover:border-accent-foreground/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isLoading}
                    />
                    {isLoading ? (
                        <button
                            onClick={handleStop}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-destructive/20 text-destructive transition-all duration-150 hover:bg-destructive/40 hover:scale-110 active:scale-95"
                            title="停止生成"
                            style={{ transformOrigin: 'center' }}
                        >
                            <Square className="w-4 h-4" />
                        </button>
                    ) : (
                        <button
                            onClick={handleSend}
                            disabled={!input.trim()}
                            className={cn(
                                "absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors",
                                input.trim()
                                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                    : "bg-secondary/60 text-muted-foreground cursor-not-allowed"
                            )}
                            title={aiSendShortcut === 'ctrlEnter' ? '发送 (Ctrl+Enter)' : '发送 (Enter)'}
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    )}
                </div>
                <div className="text-[10px] text-muted-foreground/50 mt-1.5 px-1">
                    {aiSendShortcut === 'ctrlEnter' ? 'Ctrl+Enter 发送 · Shift+Enter 换行' : 'Enter 发送 · Shift+Enter 换行'}
                </div>
            </div>
        </div>
    );
}

// Message Bubble Component — memo wrapper added below
function MessageBubble({ message }: { message: AgentMessage }) {
    const [expanded, setExpanded] = useState(true);

    // Compact tool-call display (for both tool results and assistant tool-call requests)
    const renderToolCall = (toolCall: NonNullable<AgentMessage['toolCall']>, content?: string) => {
        const isPending = toolCall.status === 'pending';
        // Determine icon and color based on tool name
        const isRead = toolCall.name === 'read_file';
        const isWrite = toolCall.name === 'write_file';
        const isList = toolCall.name === 'list_directory';
        const isFileOp = isRead || isWrite || isList;
        const ToolIcon = isRead ? FileText : isWrite ? Pencil : isList ? FolderOpen : Terminal;
        // Color configs per tool type
        const colorMap = {
            read_file: { accent: '#3b82f6', light: 'rgba(59,130,246,0.12)', label: '读取文件' },
            write_file: { accent: '#f59e0b', light: 'rgba(245,158,11,0.12)', label: '写入文件' },
            list_directory: { accent: '#06b6d4', light: 'rgba(6,182,212,0.12)', label: '列出目录' },
            execute_ssh_command: { accent: isPending ? '#eab308' : '#10b981', light: isPending ? 'rgba(234,179,8,0.08)' : 'rgba(16,185,129,0.06)', label: isPending ? '待批准' : '已执行' },
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
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 bg-secondary">
                            <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-secondary/60 text-foreground rounded-tl-md">
                            <MessageContent content={content} isUser={false} />
                        </div>
                    </div>
                )}
                {/* ── Tool block with accent strip ── */}
                <div
                    className="mx-1 rounded-lg overflow-hidden transition-all duration-300"
                    style={{
                        border: `1px solid ${colors.accent}20`,
                    }}
                >
                    {/* Command header with left accent strip */}
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors hover:bg-[hsl(var(--card)/0.6)]"
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
                        <div className="border-t bg-muted/50" style={{ borderColor: `${colors.accent}15` }}>
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
        <div className={cn("flex flex-col gap-0.5", isUser && "items-end")}>
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
                    "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                    isUser
                        ? "bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/20"
                        : "bg-gradient-to-br from-secondary to-secondary/60 border border-border/30"
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
                        "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                        isUser
                            ? "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-tr-md shadow-[0_2px_12px_rgba(var(--primary-rgb,234,88,12),0.15)]"
                            : "bg-secondary/60 text-foreground rounded-tl-md backdrop-blur-sm border border-border/20",
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
                                    <div key={i} className="relative h-3 rounded-full overflow-hidden" style={{ width: `${w}%`, background: 'rgba(255,255,255,0.1)' }}>
                                        <div className="absolute inset-0 rounded-full" style={{
                                            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.30) 45%, transparent 100%)',
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
                    <span title="Prompt tokens">↑{tokenInfo.promptTokens.toLocaleString()}</span>
                    <span title="Completion tokens">↓{tokenInfo.completionTokens.toLocaleString()}</span>
                    <span className="opacity-50">=</span>
                    <span title="Total tokens" className="font-medium opacity-60">{tokenInfo.totalTokens.toLocaleString()} tok</span>
                </div>
            )}
        </div>
    );
}
// Memoized wrapper — skips re-render when chatWidth changes during drag resize
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
                                <div className="flex items-center justify-between px-3 py-1 bg-black/20 text-[10px] text-muted-foreground">
                                    <span>{lang}</span>
                                </div>
                                <pre className="px-3 py-2 bg-black/30 text-xs font-mono overflow-x-auto">
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
                    <code key={`${i}-${j}`} className="px-1 py-0.5 rounded bg-black/20 text-[12px] font-mono">
                        {cp.slice(1, -1)}
                    </code>
                );
            }
            return <span key={`${i}-${j}`}>{cp}</span>;
        });
    });
}


