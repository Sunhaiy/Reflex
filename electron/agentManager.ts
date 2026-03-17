// Centralized Agent Plan State Machine — runs in the main process
// Replaces the Renderer-side runPlanLoop in AIChatPanel.tsx

import { WebContents } from 'electron';
import { callLLM, LLMProfile } from './llm.js';
import { SSHManager } from './ssh/sshManager.js';
import { AI_SYSTEM_PROMPTS } from '../src/shared/aiTypes.js';

// Mirror of src/shared/aiTypes.ts (avoid circular import between main and renderer types)
interface PlanStep {
    id: number;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'waiting_approval';
    command?: string;
    result?: string;
    error?: string;
    requires_approval?: boolean;
}

interface PlanState {
    global_goal: string;
    scratchpad: string;
    plan: PlanStep[];
}

interface AgentMsg {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
    toolCall?: { name: string; command: string; status: 'pending' | 'executed' };
    isError?: boolean;
}

interface Assessment {
    success: boolean;
    note: string;
    scratchpad_update?: string;
}

interface EnvironmentInfo {
    user: string;
    pwd: string;
    os: string;
    docker: string;
}

interface SessionState {
    aborted: boolean;
    planState: PlanState | null;
    webContents: WebContents;
    abortController: AbortController;
    env?: EnvironmentInfo;
    pendingApprovalCommand?: string;
}

// ── Utility functions ────────────────────────────────────────────────────────

function denoiseOutput(raw: string, maxLines = 100): string {
    // 移除 ANSI 转义序列和回车
    const stripped = raw.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').replace(/\r/g, '');
    const lines = stripped.split('\n').filter(l => l.trim());
    if (lines.length <= maxLines) return lines.join('\n');
    // 保留头 30 行 + 尾 20 行，中间省略
    const head = lines.slice(0, 30).join('\n');
    const tail = lines.slice(-20).join('\n');
    return `${head}\n\n[...省略 ${lines.length - 50} 行...]\n\n${tail}`;
}

function trimScratchpad(scratchpad: string, maxChars = 3000): string {
    if (scratchpad.length <= maxChars) return scratchpad;
    return `[...早期信息已截断...]\n` + scratchpad.slice(-maxChars);
}

export class AgentManager {
    sessions = new Map<string, SessionState>();

    constructor(private sshMgr: SSHManager) {}

    // ── Push helpers ────────────────────────────────────────────────────────────

    private pushUpdate(id: string, sess: SessionState, planState: PlanState | null, planPhase: string) {
        if (!sess.webContents.isDestroyed()) {
            sess.webContents.send('agent-plan-update', { sessionId: id, planState, planPhase });
        }
    }

    private pushMsg(id: string, sess: SessionState, msg: AgentMsg) {
        if (!sess.webContents.isDestroyed()) {
            sess.webContents.send('agent-push-msg', { sessionId: id, message: msg });
        }
    }

    private updateMsg(id: string, sess: SessionState, messageId: string, updates: Partial<AgentMsg>) {
        if (!sess.webContents.isDestroyed()) {
            sess.webContents.send('agent-update-msg', { sessionId: id, messageId, updates });
        }
    }

    private injectTerminal(id: string, sess: SessionState, text: string) {
        if (!sess.webContents.isDestroyed()) {
            sess.webContents.send('terminal-data', { id, data: text });
        }
    }

    // ── Environment probe ────────────────────────────────────────────────────

    private async probeEnvironment(sessionId: string): Promise<EnvironmentInfo> {
        const cmd = 'printf "USER:%s\\nPWD:%s\\nOS:%s\\nDOCKER:%s\\n" "$(whoami)" "$(pwd)" "$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d \'"\')" "$(systemctl is-active docker 2>/dev/null || echo N/A)"';
        try {
            const result = await this.sshMgr.exec(sessionId, cmd, 5000);
            const lines = result.stdout.split('\n');
            const get = (prefix: string) =>
                lines.find(l => l.startsWith(prefix))?.slice(prefix.length).trim() || '';
            return {
                user:   get('USER:')   || 'unknown',
                pwd:    get('PWD:')    || '~',
                os:     get('OS:')     || 'Linux',
                docker: get('DOCKER:') || 'N/A',
            };
        } catch {
            return { user: 'unknown', pwd: '~', os: 'Linux', docker: 'N/A' };
        }
    }

    // ── SSH exec with retry + terminal injection ────────────────────────────────

    private async execCommand(
        sessionId: string,
        sess: SessionState,
        command: string,
        firstRun = true,
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        const MAX_RETRIES = 5;
        const RETRY_DELAY_MS = 3000;
        const isConnError = (msg: string) =>
            /not connected|no response|handshake|connection lost|ECONNRESET|ETIMEDOUT/i.test(msg);

        if (firstRun) {
            this.injectTerminal(sessionId, sess, `\r\n\x1b[36;2m[Agent] $ ${command}\x1b[0m\r\n`);
        }

        // Suppress pager programs so output always returns cleanly
        const wrapped = `PAGER=cat SYSTEMD_PAGER=cat GIT_PAGER=cat TERM=dumb ${command}`;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result = await this.sshMgr.exec(sessionId, wrapped, 120000);
                if (result.stdout) {
                    this.injectTerminal(sessionId, sess, result.stdout.replace(/\n/g, '\r\n'));
                }
                if (result.stderr) {
                    this.injectTerminal(sessionId, sess, `\x1b[33m${result.stderr.replace(/\n/g, '\r\n')}\x1b[0m`);
                }
                this.injectTerminal(sessionId, sess, `\x1b[2m[exit ${result.exitCode}]\x1b[0m\r\n`);
                return result;
            } catch (err: any) {
                const errMsg: string = err?.message || String(err);
                if (isConnError(errMsg) && attempt < MAX_RETRIES) {
                    this.injectTerminal(sessionId, sess,
                        `\r\n\x1b[33m[Agent] 连接中断，${RETRY_DELAY_MS / 1000}s 后重试 (${attempt}/${MAX_RETRIES})...\x1b[0m\r\n`
                    );
                    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                    try { await this.sshMgr.reconnect(sessionId); } catch { /* ignore */ }
                    this.injectTerminal(sessionId, sess,
                        `\x1b[36;2m[Agent] $ ${command}  (重试 ${attempt + 1}/${MAX_RETRIES})\x1b[0m\r\n`
                    );
                    continue;
                }
                throw err;
            }
        }
        throw new Error('SSH exec failed after maximum retries');
    }

    // ── LLM sub-agent calls ─────────────────────────────────────────────────────

    private async plannerCall(profile: LLMProfile, goal: string, signal: AbortSignal): Promise<PlanState> {
        const content = await callLLM(profile, [
            { role: 'system', content: AI_SYSTEM_PROMPTS.planner },
            { role: 'user', content: goal },
        ], { temperature: 0.3, maxTokens: 2048, signal });
        const raw = content.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
        let state: PlanState;
        try {
            state = JSON.parse(raw) as PlanState;
        } catch {
            throw new Error(`AI 返回了无效的 JSON：${raw.slice(0, 150)}`);
        }
        if (!state.global_goal || !Array.isArray(state.plan) || state.plan.length === 0)
            throw new Error(`AI 返回的计划格式不正确：${raw.slice(0, 150)}`);
        return state;
    }

    private async executorCall(profile: LLMProfile, state: PlanState, step: PlanStep, signal: AbortSignal): Promise<string> {
        const userContent = `全局目标：${state.global_goal}\n已知信息：${state.scratchpad || '无'}\n当前子任务：${step.description}`;
        try {
            const content = await callLLM(profile, [
                { role: 'system', content: AI_SYSTEM_PROMPTS.executor },
                { role: 'user', content: userContent },
            ], { temperature: 0.2, maxTokens: 512, signal });
            return content.trim().replace(/^`{1,3}(?:bash|sh)?\n?|`{1,3}$/g, '').trim();
        } catch (err: any) {
            if (err?.name === 'AbortError') throw err;
            return `echo "执行器生成命令失败: ${step.description}"`;
        }
    }

    private async assessorCall(
        profile: LLMProfile,
        step: PlanStep,
        result: { stdout: string; stderr: string; exitCode: number },
        signal: AbortSignal,
    ): Promise<Assessment> {
        const userContent =
            `子任务：${step.description}\n` +
            `执行命令：${step.command || ''}\n` +
            `退出码：${result.exitCode}\n` +
            `stdout：${denoiseOutput(result.stdout).slice(0, 2000)}\n` +
            `stderr：${denoiseOutput(result.stderr, 50).slice(0, 800)}`;
        try {
            const content = await callLLM(profile, [
                { role: 'system', content: AI_SYSTEM_PROMPTS.assessor },
                { role: 'user', content: userContent },
            ], { temperature: 0.1, maxTokens: 512, signal });
            const raw = content.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
            return JSON.parse(raw);
        } catch {
            return {
                success: result.exitCode === 0,
                note: result.exitCode === 0 ? '命令执行成功' : `退出码 ${result.exitCode}`,
            };
        }
    }

    private async replannerCall(
        profile: LLMProfile,
        state: PlanState,
        failedStep: PlanStep,
        errorOutput: string,
        signal: AbortSignal,
    ): Promise<PlanState | null> {
        const userContent =
            `当前任务状态：\n${JSON.stringify(state, null, 2)}\n\n` +
            `失败步骤：${failedStep.description}\n` +
            `错误输出：${errorOutput.slice(0, 1000)}`;
        try {
            const content = await callLLM(profile, [
                { role: 'system', content: AI_SYSTEM_PROMPTS.replanner },
                { role: 'user', content: userContent },
            ], { temperature: 0.4, maxTokens: 2048, signal });
            const raw = content.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
            const newState = JSON.parse(raw) as PlanState;
            if (!newState.global_goal || !Array.isArray(newState.plan))
                throw new Error('invalid replan');
            return newState;
        } catch {
            return null;
        }
    }

    // ── Main plan loop ──────────────────────────────────────────────────────────

    private async runPlanLoop(
        sessionId: string,
        sess: SessionState,
        state: PlanState,
        profile: LLMProfile,
    ): Promise<'done' | 'stopped' | 'paused' | 'waiting_approval'> {
        const MAX_REPLAN = 3;
        let replanCount = 0;
        const { signal } = sess.abortController;

        const syncState = (phase = 'executing') => {
            sess.planState = state;
            this.pushUpdate(sessionId, sess, state, phase);
        };

        while (!sess.aborted) {
            const step = state.plan.find(p => p.status === 'pending');
            if (!step) break;

            // 1. Mark in_progress
            step.status = 'in_progress';
            syncState();

            // 2. Executor generates command
            const command = await this.executorCall(profile, state, step, signal);
            if (sess.aborted) break;

            // 3. Detect __ASK_USER__ signal — pause and ask user
            if (command.startsWith('__ASK_USER__:')) {
                const question = command.slice('__ASK_USER__:'.length).trim();
                const askMsg: AgentMsg = {
                    id: `plan-ask-${Date.now()}`,
                    role: 'assistant',
                    content: question,
                    timestamp: Date.now(),
                };
                this.pushMsg(sessionId, sess, askMsg);
                syncState('paused');
                return 'paused';
            }

            step.command = command;
            syncState();

            // 3.5 危险操作审批门 — 暂停等待用户确认
            if (step.requires_approval) {
                const approvalMsg: AgentMsg = {
                    id: `plan-approval-${Date.now()}`,
                    role: 'assistant',
                    content: `⚠️ 以下步骤被标记为**危险操作**，需要您确认后才能执行：\n\n操作：${step.description}\n命令：${command}\n\n请回复 **"确认执行"** 继续，或任何其他内容跳过此步骤。`,
                    timestamp: Date.now(),
                };
                this.pushMsg(sessionId, sess, approvalMsg);
                sess.pendingApprovalCommand = command;
                syncState('waiting_approval');
                return 'waiting_approval';
            }

            // 4. Inject tool-call message into chat
            const callMsgId = `plan-call-${Date.now()}`;
            const callMsg: AgentMsg = {
                id: callMsgId,
                role: 'assistant',
                content: step.description,
                timestamp: Date.now(),
                toolCall: { name: 'execute_ssh_command', command, status: 'pending' },
            };
            this.pushMsg(sessionId, sess, callMsg);

            // 5. Execute SSH command
            let result: { stdout: string; stderr: string; exitCode: number };
            try {
                result = await this.execCommand(sessionId, sess, command);
            } catch (err: any) {
                step.status = 'failed';
                step.error = `SSH 执行失败: ${err?.message || err}`;
                this.updateMsg(sessionId, sess, callMsgId, {
                    toolCall: { name: 'execute_ssh_command', command, status: 'executed' },
                });
                const errMsg: AgentMsg = {
                    id: `plan-result-${Date.now()}`,
                    role: 'tool',
                    content: step.error,
                    timestamp: Date.now(),
                    toolCall: { name: 'execute_ssh_command', command, status: 'executed' },
                    isError: true,
                };
                this.pushMsg(sessionId, sess, errMsg);
                break;
            }

            if (sess.aborted) break;

            // 6. Update call message to 'executed' + push result
            this.updateMsg(sessionId, sess, callMsgId, {
                toolCall: { name: 'execute_ssh_command', command, status: 'executed' },
            });
            const resultContent = [result.stdout, result.stderr].filter(Boolean).join('\n').trim() || '(无输出)';
            const resultMsg: AgentMsg = {
                id: `plan-result-${Date.now()}`,
                role: 'tool',
                content: resultContent,
                timestamp: Date.now(),
                toolCall: { name: 'execute_ssh_command', command, status: 'executed' },
            };
            this.pushMsg(sessionId, sess, resultMsg);

            // 7. Assessor evaluates
            const assessment = await this.assessorCall(profile, step, result, signal);
            if (sess.aborted) break;

            if (assessment.success) {
                step.status = 'completed';
                step.result = assessment.note;
                if (assessment.scratchpad_update) {
                    state.scratchpad = trimScratchpad(
                        [state.scratchpad, assessment.scratchpad_update].filter(Boolean).join('\n')
                    );
                }
                replanCount = 0;
                syncState();
            } else {
                step.status = 'failed';
                step.error = assessment.note;
                replanCount++;

                if (replanCount > MAX_REPLAN) {
                    syncState();
                    break;
                }

                const replanNoteMsg: AgentMsg = {
                    id: `plan-replan-${Date.now()}`,
                    role: 'assistant',
                    content: `步骤失败，正在重新规划：${assessment.note}`,
                    timestamp: Date.now(),
                };
                this.pushMsg(sessionId, sess, replanNoteMsg);

                const newState = await this.replannerCall(profile, state, step, result.stderr || result.stdout, signal);
                if (!newState) { syncState(); break; }
                state = { ...newState, plan: newState.plan.map(p => ({ ...p })) };
                syncState();
            }
        }

        const hasPending = state.plan.some(p => p.status === 'pending' || p.status === 'in_progress');
        const finalPhase = hasPending ? 'stopped' : 'done';
        sess.planState = state;
        this.pushUpdate(sessionId, sess, state, finalPhase);
        return finalPhase;
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    startPlan(sessionId: string, goal: string, profile: LLMProfile, webContents: WebContents, sshHost = ''): void {
        this.stop(sessionId); // abort any currently running session

        const abortController = new AbortController();
        const sess: SessionState = { aborted: false, planState: null, webContents, abortController };
        this.sessions.set(sessionId, sess);

        // Fire-and-forget: plan loop runs async, pushes events to renderer
        (async () => {
            try {
                this.pushUpdate(sessionId, sess, null, 'generating');

                // Phase 1: 环境探针（静默，<5s）
                const env = await this.probeEnvironment(sessionId);
                sess.env = env;

                // 构建携带环境上下文的 goal
                const envBlock = `[服务器环境] 用户:${env.user} | 目录:${env.pwd} | OS:${env.os} | Docker:${env.docker}`;
                const hostNote = sshHost ? `已连接到 ${sshHost}` : 'SSH已连接';
                const contextualGoal = `[${hostNote}，${envBlock}，无需询问 SSH 连接信息]\n\n用户任务：${goal}`;

                const state = await this.plannerCall(profile, contextualGoal, abortController.signal);
                if (sess.aborted) return;

                // 将环境信息写入 scratchpad 初始值，供 executor 使用
                state.scratchpad = envBlock;

                sess.planState = state;
                this.pushUpdate(sessionId, sess, state, 'executing');
                await this.runPlanLoop(sessionId, sess, state, profile);
            } catch (err: any) {
                if ((err as any)?.name === 'AbortError') return; // user stopped, no error message needed
                console.error(`[AgentManager] startPlan error (${sessionId}):`, err);
                this.pushMsg(sessionId, sess, {
                    id: `plan-err-${Date.now()}`,
                    role: 'assistant',
                    content: `❌ 计划模式出错：${err?.message || String(err)}`,
                    timestamp: Date.now(),
                    isError: true,
                });
                this.pushUpdate(sessionId, sess, sess.planState, 'stopped');
            }
        })();
    }

    stop(sessionId: string): void {
        const sess = this.sessions.get(sessionId);
        if (sess) {
            sess.aborted = true;
            sess.abortController.abort(); // immediately cancel any in-flight LLM request
            this.pushUpdate(sessionId, sess, sess.planState, 'stopped');
        }
    }

    resume(sessionId: string, userInput: string, webContents: WebContents, profile: LLMProfile): void {
        const sess = this.sessions.get(sessionId);
        const state = sess?.planState;
        if (!sess || !state) return;

        // Update webContents (tab switch) and reset abort state with a fresh controller
        sess.webContents = webContents;
        sess.aborted = false;
        sess.abortController = new AbortController();

        // 场景 A：从审批暂停恢复
        if (sess.pendingApprovalCommand !== undefined) {
            const approvedCommand = sess.pendingApprovalCommand;
            sess.pendingApprovalCommand = undefined;

            const approved = /确认执行|confirm|yes|^y$/i.test(userInput.trim());
            if (!approved) {
                // 用户拒绝：将当前 in_progress 步骤标记 skipped，继续循环
                const pendingStep = state.plan.find(p => p.status === 'in_progress');
                if (pendingStep) { pendingStep.status = 'skipped'; pendingStep.result = '用户取消'; }
                this.pushUpdate(sessionId, sess, state, 'executing');
                (async () => {
                    try {
                        await this.runPlanLoop(sessionId, sess, state, profile);
                    } catch (err: any) {
                        if ((err as any)?.name === 'AbortError') return;
                        console.error(`[AgentManager] resume(skip) error (${sessionId}):`, err);
                        this.pushUpdate(sessionId, sess, sess.planState, 'stopped');
                    }
                })();
                return;
            }

            // 用户确认：执行已暂存的命令，跳过 executor 重新生成
            const pendingStep = state.plan.find(p => p.status === 'in_progress');
            if (!pendingStep) {
                // 找不到待执行步骤，直接继续循环
                this.pushUpdate(sessionId, sess, state, 'executing');
                (async () => { await this.runPlanLoop(sessionId, sess, state, profile); })();
                return;
            }
            pendingStep.command = approvedCommand;
            this.pushUpdate(sessionId, sess, state, 'executing');

            (async () => {
                try {
                    // 注入工具调用消息
                    const callMsgId = `plan-call-${Date.now()}`;
                    this.pushMsg(sessionId, sess, {
                        id: callMsgId,
                        role: 'assistant',
                        content: pendingStep.description,
                        timestamp: Date.now(),
                        toolCall: { name: 'execute_ssh_command', command: approvedCommand, status: 'pending' },
                    });

                    // 执行命令
                    const result = await this.execCommand(sessionId, sess, approvedCommand);

                    this.updateMsg(sessionId, sess, callMsgId, {
                        toolCall: { name: 'execute_ssh_command', command: approvedCommand, status: 'executed' },
                    });
                    const resultContent = [result.stdout, result.stderr].filter(Boolean).join('\n').trim() || '(无输出)';
                    this.pushMsg(sessionId, sess, {
                        id: `plan-result-${Date.now()}`,
                        role: 'tool',
                        content: resultContent,
                        timestamp: Date.now(),
                        toolCall: { name: 'execute_ssh_command', command: approvedCommand, status: 'executed' },
                    });

                    // 评估结果
                    const assessment = await this.assessorCall(profile, pendingStep, result, sess.abortController.signal);
                    if (assessment.success) {
                        pendingStep.status = 'completed';
                        pendingStep.result = assessment.note;
                        if (assessment.scratchpad_update) {
                            state.scratchpad = trimScratchpad(
                                [state.scratchpad, assessment.scratchpad_update].filter(Boolean).join('\n')
                            );
                        }
                    } else {
                        pendingStep.status = 'failed';
                        pendingStep.error = assessment.note;
                    }
                    sess.planState = state;
                    // 继续后续步骤
                    await this.runPlanLoop(sessionId, sess, state, profile);
                } catch (err: any) {
                    if ((err as any)?.name === 'AbortError') return;
                    console.error(`[AgentManager] resume(approve) error (${sessionId}):`, err);
                    this.pushUpdate(sessionId, sess, sess.planState, 'stopped');
                }
            })();
            return;
        }

        // 场景 B：从 __ASK_USER__ 暂停恢复（原有逻辑）
        const askStep = state.plan.find(p => p.status === 'in_progress');
        if (askStep) {
            askStep.status = 'completed';
            askStep.result = `用户提供: ${userInput}`;
        }
        state.scratchpad = trimScratchpad(
            [state.scratchpad, `用户提供: ${userInput}`].filter(Boolean).join('\n')
        );

        this.pushUpdate(sessionId, sess, state, 'executing');

        (async () => {
            try {
                await this.runPlanLoop(sessionId, sess, state, profile);
            } catch (err: any) {
                if ((err as any)?.name === 'AbortError') return;
                console.error(`[AgentManager] resume error (${sessionId}):`, err);
                this.pushMsg(sessionId, sess, {
                    id: `plan-err-${Date.now()}`,
                    role: 'assistant',
                    content: `❌ 计划模式出错：${err?.message || String(err)}`,
                    timestamp: Date.now(),
                    isError: true,
                });
                this.pushUpdate(sessionId, sess, sess.planState, 'stopped');
            }
        })();
    }

    cleanup(sessionId: string): void {
        const sess = this.sessions.get(sessionId);
        if (sess) {
            sess.aborted = true;
            sess.abortController.abort();
        }
        this.sessions.delete(sessionId);
    }
}
