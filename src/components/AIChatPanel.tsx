// AIChatPanel - Agent mode chat interface
import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Bot, User, Send, Loader2, Sparkles, ChevronDown, ChevronRight, Terminal, Square, Zap, Shield, ShieldCheck, Check, X } from 'lucide-react';
import { aiService } from '../services/aiService';
import { AI_SYSTEM_PROMPTS, AGENT_TOOLS } from '../shared/aiTypes';
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
    isStreaming?: boolean;
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
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const latestMessagesRef = useRef(messages);
    const { aiSendShortcut, agentControlMode, setAgentControlMode, agentWhitelist } = useSettingsStore();
    const { t } = useTranslation();
    const agentControlModeRef = useRef(agentControlMode);
    const agentWhitelistRef = useRef(agentWhitelist);
    const isLoadingRef = useRef(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionIdRef = useRef(sessionId);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

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
            // Auto-generate title from first user message
            const firstUser = messages.find(m => m.role === 'user');
            const title = firstUser
                ? firstUser.content.replace(/\s+/g, ' ').slice(0, 40) + (firstUser.content.length > 40 ? '…' : '')
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
    const execCommand = async (command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        const eWindow = window as any;
        if (!eWindow.electron?.sshExec) {
            throw new Error('SSH exec not available');
        }
        // Show command in terminal display (NOT PTY stdin — no pager, no double-exec)
        eWindow.electron.terminalInject?.(connectionId, `\r\n\x1b[36;2m[Agent] $ ${command}\x1b[0m\r\n`);
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
        eWindow.electron.terminalInject?.(connectionId,
            `\x1b[2m[exit ${result.exitCode}]\x1b[0m\r\n`
        );
        return result;
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
        return chatMsgs;
    };

    // The Agent Loop
    const runAgentLoop = async (currentMessages: AgentMessage[]) => {
        const MAX_ITERATIONS = 15;

        let loopMessages = [...currentMessages];

        for (let i = 0; i < MAX_ITERATIONS; i++) {
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
                const chatMessages = buildChatMessages(loopMessages);
                const response = await aiService.completeWithTools({
                    messages: chatMessages,
                    tools: AGENT_TOOLS,
                    temperature: 0.7,
                });

                // Remove thinking indicator
                // Case 1: AI returned text (no tool call) — done
                if (!response.toolCalls || response.toolCalls.length === 0) {
                    const assistantMsg: AgentMessage = {
                        id: `asst-${Date.now()}`,
                        role: 'assistant',
                        content: response.content || '（无回复）',
                        timestamp: Date.now(),
                    };
                    loopMessages = [...loopMessages, assistantMsg];
                    onMessagesChange(loopMessages);
                    break; // Loop ends — AI is done
                }

                // Case 2: AI wants to call a tool
                const toolCall = response.toolCalls[0];
                const args = JSON.parse(toolCall.function.arguments);
                const command = args.command as string;

                // Add AI's thinking text + tool call intent as assistant message
                const toolCallMsgId = `call-${Date.now()}`;
                const assistantToolMsg: AgentMessage = {
                    id: toolCallMsgId,
                    role: 'assistant',
                    content: response.content || '',
                    timestamp: Date.now(),
                    toolCall: {
                        name: 'execute_ssh_command',
                        command: command,
                        status: 'pending',
                    },
                };
                loopMessages = [...loopMessages, assistantToolMsg];
                onMessagesChange(loopMessages);

                // Check safety mode
                if (needsApproval(command)) {
                    // Queue for approval — pause the loop
                    setPendingCommands(prev => [...prev, {
                        cmd: command,
                        msgId: toolCallMsgId,
                        aiMessages: loopMessages, // snapshot for resuming
                    }]);
                    break; // Loop pauses — will resume when user approves
                }

                // Execute immediately
                const result = await execCommand(command);

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
                        name: 'execute_ssh_command',
                        command: command,
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
                };
                loopMessages = [...loopMessages, errorMsg];
                onMessagesChange(loopMessages);
                break;
            }
        }
    };

    // Resume agent loop after user approves a pending command
    const resumeAfterApproval = async (command: string, msgId: string, snapshotMessages: AgentMessage[]) => {
        setIsLoading(true);
        isLoadingRef.current = true;

        try {
            const result = await execCommand(command);

            // Update the assistant message to show executed
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
            };
            onMessagesChange([...latestMessagesRef.current, errorMsg]);
        } finally {
            setIsLoading(false);
            isLoadingRef.current = false;
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
        setIsLoading(true);
        isLoadingRef.current = true;

        try {
            await runAgentLoop(updatedMessages);
        } finally {
            setIsLoading(false);
            isLoadingRef.current = false;
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
                    <MessageBubble key={msg.id} message={msg} />
                ))}

                {isLoading && messages[messages.length - 1]?.content === '' && (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm px-4">
                        <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span>思考中...</span>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

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
            <div className="border-t border-border p-3 bg-background/50">
                {/* Mode selector bar */}
                <div className="flex items-center gap-2 mb-2 relative">
                    <button
                        onClick={() => setShowModeMenu(!showModeMenu)}
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
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
                            title="停止生成"
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

// Message Bubble Component
function MessageBubble({ message }: { message: AgentMessage }) {
    const [expanded, setExpanded] = useState(true);

    // Compact tool-call display (for both tool results and assistant tool-call requests)
    const renderToolCall = (toolCall: NonNullable<AgentMessage['toolCall']>, content?: string) => {
        const isPending = toolCall.status === 'pending';
        return (
            <div className="space-y-1.5">
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
                {/* Compact tool call line */}
                <div className="px-2">
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                    >
                        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <Terminal className={cn("w-3 h-3", isPending ? "text-yellow-500" : "text-primary")} />
                        <span className="font-mono">{toolCall.command}</span>
                        {isPending ? (
                            <span className="ml-auto text-[10px] text-yellow-500">⏳ 待批准</span>
                        ) : (
                            <span className="ml-auto text-[10px] text-green-500">✓ 已执行</span>
                        )}
                    </button>
                    {/* Show output for tool result messages */}
                    {expanded && message.role === 'tool' && message.content && (
                        <pre className="mt-1 ml-5 text-[11px] text-muted-foreground/80 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {message.content}
                        </pre>
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

    return (
        <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
            {/* Avatar */}
            <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                isUser ? "bg-primary/20" : "bg-secondary"
            )}>
                {isUser ? (
                    <User className="w-3.5 h-3.5 text-primary" />
                ) : (
                    <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                )}
            </div>

            {/* Content */}
            <div className={cn(
                "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                isUser
                    ? "bg-primary text-primary-foreground rounded-tr-md"
                    : "bg-secondary/60 text-foreground rounded-tl-md"
            )}>
                {message.isStreaming && !message.content && (
                    <div className="flex gap-1 py-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                )}
                <MessageContent content={message.content} isUser={isUser} />
            </div>
        </div>
    );
}

// Simple markdown-ish content renderer
function MessageContent({ content, isUser }: { content: string; isUser: boolean }) {
    if (!content) return null;

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
                return (
                    <span key={i} className="whitespace-pre-wrap break-words">
                        {part.split('\n').map((line, j) => (
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
