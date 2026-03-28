import path from 'path';
import { WebContents } from 'electron';
import { DeploymentManager } from '../deploy/deploymentManager.js';
import {
  callLLMWithTools,
  LLMMessage,
  LLMProfile,
  LLMToolCall,
} from '../llm.js';
import { SSHManager } from '../ssh/sshManager.js';
import { PlanState } from '../../src/shared/aiTypes.js';
import { appendScratchpad, buildSystemPrompt, makeArtifactPreview } from './contextBuilder.js';
import { buildLocalContext, createAgentToolRegistry, probeRemoteContext } from './toolRegistry.js';
import {
  AgentArtifact,
  AgentRuntimeMessage,
  AgentThreadSession,
} from './types.js';

interface StartAgentInput {
  sessionId: string;
  connectionId?: string;
  goal: string;
  profile: LLMProfile;
  sshHost?: string;
  threadMessages?: AgentRuntimeMessage[];
}

interface ResumeAgentInput {
  sessionId: string;
  connectionId?: string;
  userInput: string;
  profile: LLMProfile;
  sshHost?: string;
  threadMessages?: AgentRuntimeMessage[];
}

const DEPLOY_INTENT_RE = /(?:\bdeploy\b|\bpublish\b|部署|发布|上线)/i;
const LOCAL_PROJECT_PATH_RE = /[A-Za-z]:\\[^\r\n"'`<>|]+|\/(?:Users|home|opt|srv|var|tmp)[^\r\n"'`<>|]*/g;

function now() {
  return Date.now();
}

function clip(text: string, maxChars = 2000): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function createPlanState(goal: string): PlanState {
  return {
    global_goal: goal,
    scratchpad: '',
    plan: [],
  };
}

function serializeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function summarizeThreadMessages(messages?: AgentRuntimeMessage[]): LLMMessage[] {
  if (!messages?.length) return [];
  return messages
    .slice(-12)
    .filter((message) => !message.toolCall)
    .map((message) => ({
      role: message.role === 'tool' ? 'assistant' : message.role,
      content: clip(message.content, 1200),
    }));
}

function makeArtifact(title: string, content: string): AgentArtifact {
  const id = `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    title,
    preview: makeArtifactPreview(content),
    content,
    createdAt: Date.now(),
  };
}

function toolCallSummary(name: string, args: Record<string, unknown>): string {
  const mapping: Record<string, string> = {
    local_list_directory: '检查本地目录',
    local_read_file: '读取本地文件',
    local_write_file: '写入本地文件',
    local_exec: '执行本地命令',
    remote_exec: '执行远程命令',
    remote_list_directory: '检查远程目录',
    remote_read_file: '读取远程文件',
    remote_write_file: '写入远程文件',
    deploy_project: '自动部署项目',
  };
  const label = mapping[name] || name;
  const mainArg = typeof args.command === 'string'
    ? args.command
    : typeof args.path === 'string'
      ? args.path
      : typeof args.projectRoot === 'string'
        ? args.projectRoot
        : '';
  return mainArg ? `${label}: ${mainArg}` : label;
}

function extractDeployProjectPath(input: string, knownPaths: string[]): string | null {
  const matches = input.match(LOCAL_PROJECT_PATH_RE) || [];
  if (matches.length > 0) {
    const bestMatch = matches.sort((a, b) => b.length - a.length)[0];
    return bestMatch ? bestMatch.trim() : null;
  }
  return knownPaths.length > 0 ? (knownPaths[knownPaths.length - 1] || null) : null;
}

export class AgentV2Manager {
  private sessions = new Map<string, AgentThreadSession>();
  private toolRegistry;

  constructor(
    private sshMgr: SSHManager,
    private deploymentManager: DeploymentManager,
  ) {
    this.toolRegistry = createAgentToolRegistry(sshMgr, deploymentManager);
  }

  startPlan(sessionId: string, input: StartAgentInput, webContents: WebContents) {
    this.startOrContinue(sessionId, {
      connectionId: input.connectionId || sessionId,
      goal: input.goal,
      profile: input.profile,
      sshHost: input.sshHost,
      webContents,
      threadMessages: input.threadMessages,
      resetPlan: true,
    }).catch((error) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.emitAssistantMessage(session, {
          id: `agent-error-${Date.now()}`,
          role: 'assistant',
          content: `执行失败：${error?.message || String(error)}`,
          timestamp: Date.now(),
          isError: true,
        });
        this.emitPlanUpdate(session, 'stopped');
      }
    });
  }

  resume(sessionId: string, input: ResumeAgentInput, webContents: WebContents) {
    this.startOrContinue(sessionId, {
      connectionId: input.connectionId || this.sessions.get(sessionId)?.connectionId || sessionId,
      goal: input.userInput,
      profile: input.profile,
      sshHost: input.sshHost,
      webContents,
      threadMessages: input.threadMessages,
      resetPlan: false,
    }).catch((error) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.emitAssistantMessage(session, {
          id: `agent-error-${Date.now()}`,
          role: 'assistant',
          content: `继续执行失败：${error?.message || String(error)}`,
          timestamp: Date.now(),
          isError: true,
        });
        this.emitPlanUpdate(session, 'stopped');
      }
    });
  }

  stop(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.aborted = true;
    session.running = false;
    session.abortController?.abort();
    this.deploymentManager.cancel(session.connectionId);
    this.emitPlanUpdate(session, 'stopped');
  }

  cleanup(sessionId: string) {
    this.stop(sessionId);
    this.sessions.delete(sessionId);
  }

  private async startOrContinue(
    sessionId: string,
    options: {
      connectionId: string;
      goal: string;
      profile: LLMProfile;
      sshHost?: string;
      webContents: WebContents;
      threadMessages?: AgentRuntimeMessage[];
      resetPlan: boolean;
    },
  ) {
    if (!options.profile?.baseUrl || !options.profile?.model) {
      throw new Error('AI profile is incomplete');
    }

    const session = await this.ensureSession(sessionId, options);
    if (session.running) {
      throw new Error('Agent is already running in this conversation');
    }

    session.aborted = false;
    session.running = true;
    session.profile = options.profile;
    session.webContents = options.webContents;
    session.abortController = new AbortController();
    session.consecutiveFailures = 0;
    session.turnCounter = 0;

    if (options.resetPlan) {
      session.planState = createPlanState(options.goal);
      session.history = summarizeThreadMessages(options.threadMessages);
    } else {
      session.planState.global_goal = options.goal;
    }

    const remoteHost = options.sshHost || this.sshMgr.getConnectionConfig(session.connectionId)?.host || session.sshHost;
    session.sshHost = remoteHost;
    session.remoteContext = await probeRemoteContext(this.sshMgr, session.connectionId, remoteHost).catch(() => ({
      host: remoteHost,
      user: 'unknown',
      pwd: '~',
      os: 'unknown',
      node: 'unknown',
      docker: 'unknown',
    }));

    this.captureKnownProjectPaths(session, options.goal);
    this.historyPush(session, { role: 'user', content: options.goal });
    const autoDeployHandled = await this.tryDirectDeployRoute(session, options.goal);
    if (autoDeployHandled) {
      session.running = false;
      this.emitPlanUpdate(session, session.aborted ? 'stopped' : 'done');
      return;
    }
    this.emitPlanUpdate(session, 'generating');
    await this.runLoop(session);
  }

  private async ensureSession(
    sessionId: string,
    options: {
      connectionId: string;
      goal: string;
      profile: LLMProfile;
      sshHost?: string;
      webContents: WebContents;
    },
  ): Promise<AgentThreadSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.connectionId = options.connectionId;
      existing.webContents = options.webContents;
      existing.profile = options.profile;
      existing.sshHost = options.sshHost || existing.sshHost;
      return existing;
    }

    const localContext = await buildLocalContext();
    const session: AgentThreadSession = {
      id: sessionId,
      connectionId: options.connectionId,
      sshHost: options.sshHost || this.sshMgr.getConnectionConfig(options.connectionId)?.host || 'server',
      webContents: options.webContents,
      profile: options.profile,
      aborted: false,
      running: false,
      turnCounter: 0,
      consecutiveFailures: 0,
      abortController: null,
      history: [],
      compressedMemory: '',
      artifacts: new Map(),
      contextWindow: {
        promptTokens: 0,
        limitTokens: this.estimateContextLimit(options.profile),
        percentUsed: 0,
        compressionCount: 0,
        autoCompressed: false,
        summaryChars: 0,
      },
      planState: createPlanState(options.goal),
      localContext,
      knownProjectPaths: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private async runLoop(session: AgentThreadSession) {
    const maxTurns = 48;
    try {
      while (!session.aborted && session.turnCounter < maxTurns) {
        this.compactHistoryIfNeeded(session, 'before turn');
        session.turnCounter += 1;
        this.emitPlanUpdate(session, 'executing');

        const response = await callLLMWithTools(
          session.profile,
          this.buildConversation(session),
          this.toolRegistry.definitions,
          {
            temperature: 0.2,
            maxTokens: 2048,
            signal: session.abortController?.signal,
          },
        );
        this.updateContextWindow(session, response.usage);

        if (response.content?.trim()) {
          const assistantText = response.content.trim();
          this.emitAssistantMessage(session, {
            id: `agent-assistant-${Date.now()}`,
            role: 'assistant',
            content: assistantText,
            timestamp: Date.now(),
            usage: response.usage,
            modelUsed: response.modelUsed,
          });
          if (!response.toolCalls?.length) {
            this.historyPush(session, { role: 'assistant', content: assistantText });
          }
        }

        if (!response.toolCalls?.length) {
          session.running = false;
          this.emitPlanUpdate(session, 'done');
          return;
        }

        const assistantToolMessage: LLMMessage = {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls,
        };
        this.historyPush(session, assistantToolMessage);

        for (const toolCall of response.toolCalls) {
          if (session.aborted) break;
          await this.executeToolCall(session, toolCall);
        }
        this.compactHistoryIfNeeded(session, 'after tools');
      }

      if (!session.aborted && session.turnCounter >= maxTurns) {
        const content = '已达到本轮自动执行上限，系统停止继续尝试。当前已保留上下文，你可以继续给我下一条目标。';
        this.historyPush(session, { role: 'assistant', content });
        this.emitAssistantMessage(session, {
          id: `agent-limit-${Date.now()}`,
          role: 'assistant',
          content,
          timestamp: Date.now(),
          isError: true,
        });
      }
    } finally {
      session.running = false;
      this.emitPlanUpdate(session, session.aborted ? 'stopped' : 'done');
    }
  }

  private buildConversation(session: AgentThreadSession): LLMMessage[] {
    const artifactSummaries = Array.from(session.artifacts.values())
      .slice(-4)
      .map((artifact) => ({
        role: 'system' as const,
        content: `Artifact memory:\n${artifact.id}\n${artifact.title}\n${clip(artifact.preview, 800)}`,
      }));

    return [
      { role: 'system', content: buildSystemPrompt(session) },
      ...(session.compressedMemory
        ? [{
            role: 'system' as const,
            content: `Compressed background memory:\n${clip(session.compressedMemory, 5000)}`,
          }]
        : []),
      ...artifactSummaries,
      ...session.history.slice(-18),
    ];
  }

  private async tryDirectDeployRoute(session: AgentThreadSession, goal: string): Promise<boolean> {
    if (!DEPLOY_INTENT_RE.test(goal)) return false;

    const projectRoot = extractDeployProjectPath(goal, session.knownProjectPaths);
    if (!projectRoot) return false;

    const step: PlanState['plan'][number] = {
      id: session.planState.plan.length + 1,
      description: `自动部署项目: ${projectRoot}`,
      status: 'in_progress',
      command: `deploy ${projectRoot}`,
    };
    session.planState.plan.push(step);
    this.emitPlanUpdate(session, 'executing');

    this.emitAssistantMessage(session, {
      id: `deploy-route-${Date.now()}`,
      role: 'assistant',
      content: `检测到部署任务，先分析项目类型，再选择最合适的部署路线并自动执行。`,
      timestamp: Date.now(),
    });

    this.emitAssistantMessage(session, {
      id: `deploy-tool-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCall: {
        name: 'deploy_project',
        command: `deploy ${projectRoot}`,
        status: 'pending',
      },
    });
    const directToolCallId = `direct-deploy-${Date.now()}`;
    this.historyPush(session, {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: directToolCallId,
          type: 'function',
          function: {
            name: 'deploy_project',
            arguments: JSON.stringify({ projectRoot }),
          },
        },
      ],
    });

    try {
      const result = await this.toolRegistry.execute('deploy_project', { projectRoot }, session);
      step.status = result.ok ? 'completed' : 'failed';
      step.result = result.ok ? clip(result.content, 240) : undefined;
      step.error = result.ok ? undefined : clip(result.content, 240);
      session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, result.scratchpadNote);

      const serialized = serializeValue(result.structured);
      const toolContent = serialized.length > 1600 ? this.storeArtifact(session, 'deploy_project', serialized) : serialized;
      this.historyPush(session, {
        role: 'tool',
        tool_call_id: directToolCallId,
        content: toolContent,
      });
      this.emitToolResultMessage(session, 'deploy_project', `deploy ${projectRoot}`, result.content, result.ok);
      this.emitPlanUpdate(session, 'executing');

      if (result.ok) {
        const summary = result.structured as Record<string, unknown>;
        const url = typeof summary.url === 'string' && summary.url ? summary.url : session.sshHost;
        this.historyPush(session, {
          role: 'assistant',
          content: `部署完成。访问地址：${url}`,
        });
        this.emitAssistantMessage(session, {
          id: `deploy-success-${Date.now()}`,
          role: 'assistant',
          content: `部署完成。\n访问地址：${url}`,
          timestamp: Date.now(),
        });
        return true;
      }

      this.emitAssistantMessage(session, {
        id: `deploy-fallback-${Date.now()}`,
        role: 'assistant',
        content: '部署主线没有一次完成，我继续自动诊断并修复。',
        timestamp: Date.now(),
      });
      this.historyPush(session, {
        role: 'user',
        content: `${goal}\nThe deterministic deployment path failed once. Continue automatic diagnosis and repair.`,
      });
      return false;
    } catch (error: any) {
      step.status = 'failed';
      step.error = clip(error?.message || String(error), 240);
      session.planState.scratchpad = appendScratchpad(
        session.planState.scratchpad,
        `部署主线失败: ${error?.message || String(error)}`,
      );
      this.emitToolResultMessage(
        session,
        'deploy_project',
        `deploy ${projectRoot}`,
        error?.message || String(error),
        false,
      );
      this.emitAssistantMessage(session, {
        id: `deploy-fallback-${Date.now()}`,
        role: 'assistant',
        content: '部署主线失败，我继续自动诊断并修复。',
        timestamp: Date.now(),
      });
      this.historyPush(session, {
        role: 'user',
        content: `${goal}\nThe deterministic deployment path failed. Continue automatic diagnosis and repair.`,
      });
      this.emitPlanUpdate(session, 'executing');
      return false;
    }
  }

  private estimateContextLimit(profile: LLMProfile): number {
    const model = `${profile.provider}:${profile.model}`.toLowerCase();
    if (/(gpt-5|gpt-4\.1|claude|deepseek|qwen|gemini)/.test(model)) {
      return 256000;
    }
    if (/(mini|haiku|small)/.test(model)) {
      return 128000;
    }
    return 128000;
  }

  private updateContextWindow(
    session: AgentThreadSession,
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number },
  ) {
    if (!usage) return;
    const limitTokens = session.contextWindow.limitTokens || this.estimateContextLimit(session.profile);
    session.contextWindow = {
      ...session.contextWindow,
      promptTokens: usage.promptTokens,
      limitTokens,
      percentUsed: Math.min(100, (usage.promptTokens / limitTokens) * 100),
      summaryChars: session.compressedMemory.length,
    };
  }

  private compactHistoryIfNeeded(session: AgentThreadSession, reason: string) {
    const promptNearLimit = session.contextWindow.promptTokens >= session.contextWindow.limitTokens * 0.72;
    const historyTooLong = session.history.length > 20;
    if (!promptNearLimit && !historyTooLong) return false;

    const keepRecent = 10;
    if (session.history.length <= keepRecent) return false;

    const olderMessages = session.history.slice(0, -keepRecent);
    const recentMessages = session.history.slice(-keepRecent);
    const compressedSummary = this.buildCompressedMemory(session, olderMessages);
    if (!compressedSummary.trim()) return false;

    session.compressedMemory = this.mergeCompressedMemory(session.compressedMemory, compressedSummary);
    session.history = recentMessages;
    session.contextWindow = {
      ...session.contextWindow,
      compressionCount: session.contextWindow.compressionCount + 1,
      autoCompressed: true,
      summaryChars: session.compressedMemory.length,
    };
    session.planState.scratchpad = appendScratchpad(
      session.planState.scratchpad,
      `Context auto-compressed (${reason})`,
    );
    return true;
  }

  private buildCompressedMemory(session: AgentThreadSession, messages: LLMMessage[]) {
    const userMessages = messages
      .filter((message) => message.role === 'user' && message.content)
      .slice(-6)
      .map((message) => `- ${clip(message.content || '', 220)}`);
    const assistantMessages = messages
      .filter((message) => message.role === 'assistant' && !message.tool_calls && message.content)
      .slice(-4)
      .map((message) => `- ${clip(message.content || '', 220)}`);
    const toolMessages = messages
      .filter((message) => message.role === 'tool' && message.content)
      .slice(-6)
      .map((message) => `- ${clip(this.summarizeToolContent(message.content || ''), 220)}`);
    const stepNotes = session.planState.plan
      .filter((step) => step.status === 'completed' || step.status === 'failed')
      .slice(-8)
      .map((step) => `- [${step.status}] ${step.description}${step.result ? ` -> ${clip(step.result, 120)}` : step.error ? ` -> ${clip(step.error, 120)}` : ''}`);

    return [
      `Goal: ${session.planState.global_goal}`,
      session.knownProjectPaths.length ? `Known project paths:\n${session.knownProjectPaths.map((item) => `- ${item}`).join('\n')}` : '',
      stepNotes.length ? `Recent execution outcomes:\n${stepNotes.join('\n')}` : '',
      userMessages.length ? `Older user instructions:\n${userMessages.join('\n')}` : '',
      assistantMessages.length ? `Older assistant conclusions:\n${assistantMessages.join('\n')}` : '',
      toolMessages.length ? `Older tool outputs:\n${toolMessages.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private summarizeToolContent(content: string) {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (typeof parsed.url === 'string' && parsed.url) {
        return `url=${parsed.url}`;
      }
      if (typeof parsed.error === 'string' && parsed.error) {
        return `error=${parsed.error}`;
      }
      if (typeof parsed.preview === 'string' && parsed.preview) {
        return parsed.preview;
      }
      if (typeof parsed.status === 'string' && parsed.status) {
        return `status=${parsed.status}`;
      }
    } catch {
      // ignore JSON parse errors
    }
    return content.replace(/\s+/g, ' ').trim();
  }

  private mergeCompressedMemory(existing: string, next: string, maxChars = 6000) {
    const merged = existing ? `${existing}\n\n${next}` : next;
    if (merged.length <= maxChars) return merged;
    return `[compressed memory truncated]\n${merged.slice(-maxChars)}`;
  }

  private async executeToolCall(session: AgentThreadSession, toolCall: LLMToolCall) {
    const args = safeParseArgs(toolCall.function.arguments);
    const description = toolCallSummary(toolCall.function.name, args);
    const step: PlanState['plan'][number] = {
      id: session.planState.plan.length + 1,
      description,
      status: 'in_progress',
      command: description,
    };
    session.planState.plan.push(step);
    this.emitPlanUpdate(session, 'executing');

    this.emitAssistantMessage(session, {
      id: `tool-call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCall: {
        name: toolCall.function.name,
        command: description,
        status: 'pending',
      },
    });

    try {
      const result = await this.toolRegistry.execute(toolCall.function.name, args, session);
      session.consecutiveFailures = 0;
      step.status = result.ok ? 'completed' : 'failed';
      step.command = result.displayCommand;
      step.result = result.ok ? clip(result.content, 240) : undefined;
      step.error = result.ok ? undefined : clip(result.content, 240);
      session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, result.scratchpadNote);

      const serialized = serializeValue(result.structured);
      const toolContent = serialized.length > 1600 ? this.storeArtifact(session, toolCall.function.name, serialized) : serialized;
      this.historyPush(session, {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolContent,
      });
      this.emitToolResultMessage(session, toolCall.function.name, result.displayCommand, result.content, result.ok);
      this.emitPlanUpdate(session, 'executing');
    } catch (error: any) {
      session.consecutiveFailures += 1;
      const errorMessage = error?.message || String(error);
      step.status = 'failed';
      step.command = description;
      step.error = clip(errorMessage, 240);
      session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, `失败: ${description} -> ${errorMessage}`);
      this.historyPush(session, {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ ok: false, error: errorMessage }),
      });
      this.emitToolResultMessage(session, toolCall.function.name, description, errorMessage, false);
      this.emitPlanUpdate(session, 'executing');

      if (session.consecutiveFailures >= 4) {
        const content = `连续失败次数过多，已停止自动执行。最后错误：${errorMessage}`;
        this.historyPush(session, { role: 'assistant', content });
        this.emitAssistantMessage(session, {
          id: `agent-failed-${Date.now()}`,
          role: 'assistant',
          content,
          timestamp: Date.now(),
          isError: true,
        });
        session.aborted = true;
      }
    }
  }

  private storeArtifact(session: AgentThreadSession, title: string, content: string): string {
    const artifact = makeArtifact(title, content);
    session.artifacts.set(artifact.id, artifact);
    return JSON.stringify({
      ok: true,
      artifactId: artifact.id,
      title: artifact.title,
      preview: artifact.preview,
    });
  }

  private captureKnownProjectPaths(session: AgentThreadSession, input: string) {
    const matches = input.match(/[A-Za-z]:\\[^\r\n"'`<>|]+|\/(?:Users|home|opt|srv|var|tmp)[^\r\n"'`<>|]*/g) || [];
    for (const value of matches) {
      const normalized = value.includes('\\')
        ? path.normalize(value.trim())
        : value.trim();
      if (normalized && !session.knownProjectPaths.includes(normalized)) {
        session.knownProjectPaths.push(normalized);
      }
    }
  }

  private historyPush(session: AgentThreadSession, message: LLMMessage) {
    session.history.push(message);
    if (session.history.length > 24) {
      session.history = session.history.slice(-24);
    }
  }

  private emitPlanUpdate(session: AgentThreadSession, planPhase: string) {
    if (!session.webContents.isDestroyed()) {
      session.webContents.send('agent-plan-update', {
        sessionId: session.id,
        planState: session.planState,
        planPhase,
        contextWindow: session.contextWindow,
      });
    }
  }

  private emitAssistantMessage(session: AgentThreadSession, message: AgentRuntimeMessage) {
    if (!session.webContents.isDestroyed()) {
      session.webContents.send('agent-push-msg', { sessionId: session.id, message });
    }
  }

  private emitToolResultMessage(
    session: AgentThreadSession,
    toolName: string,
    command: string,
    content: string,
    ok: boolean,
  ) {
    const message: AgentRuntimeMessage = {
      id: `tool-result-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'tool',
      content: clip(content, 2200),
      timestamp: now(),
      toolCall: {
        name: toolName,
        command,
        status: 'executed',
      },
      isError: !ok,
    };
    this.emitAssistantMessage(session, message);
  }
}
