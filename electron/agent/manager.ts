import path from 'path';
import { WebContents } from 'electron';
import {
  callLLMWithTools,
  LLMMessage,
  LLMProfile,
  LLMRequestError,
  LLMToolCall,
} from '../llm.js';
import { FailureClass } from '../../src/shared/deployTypes.js';
import { PlanState } from '../../src/shared/aiTypes.js';
import type {
  AgentPlanPhase,
  AgentSessionRuntime,
  RouteHypothesis,
  RunCheckpoint,
  TaskRunFailure,
  TaskRunSummary,
} from '../../src/shared/types.js';
import { SSHManager } from '../ssh/sshManager.js';
import { HypothesisPlanner } from './hypothesisPlanner.js';
import { appendScratchpad, buildSystemPrompt, makeArtifactPreview, summarizeThreadMessages } from './prompts.js';
import { buildRepoAnalysis, summarizeKnownFacts } from './repoAnalysis.js';
import { AgentRepoInspector } from './repoInspector.js';
import { buildLocalContext, createAgentToolRegistry, probeRemoteContext } from './toolRegistry.js';
import type {
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
  restoredRuntime?: AgentSessionRuntime | null;
}

interface ResumeAgentInput {
  sessionId: string;
  connectionId?: string;
  userInput: string;
  profile: LLMProfile;
  sshHost?: string;
  threadMessages?: AgentRuntimeMessage[];
  restoredRuntime?: AgentSessionRuntime | null;
}

interface RouteExecutionResult {
  ok: boolean;
  finalUrl?: string;
  failureClass?: FailureClass;
  failureMessage?: string;
  attemptCount: number;
}

const DEPLOY_INTENT_RE = /(?:\bdeploy\b|\bpublish\b|\bship\b|部署|发布|上线)/i;
const CONTINUE_INTENT_RE = /^(继续|继续处理|继续执行|继续部署|接着|接着做|再试一次|重试|continue|resume|retry)\s*[。.!！]?$/i;
const LOCAL_PROJECT_PATH_RE = /[A-Za-z]:\\[^\r\n"'`<>|]+|\/(?:Users|home|opt|srv|var|tmp)[^\r\n"'`<>|]*/g;
const GITHUB_PROJECT_URL_RE = /https?:\/\/github\.com\/[^\s"'`<>]+/ig;
const MAX_GENERIC_TURNS = 32;
const MAX_AUTONOMOUS_REPAIRS = 5;

function now() {
  return Date.now();
}

function clip(text: string, maxChars = 2000) {
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

function isContinueIntent(input: string) {
  return CONTINUE_INTENT_RE.test(input.trim());
}

function cleanDeployCandidate(input: string) {
  return input.trim().replace(/[),.;!?，。；！]+$/, '');
}

function extractDeploySource(input: string, knownPaths: string[]): string | null {
  const githubMatches = input.match(GITHUB_PROJECT_URL_RE) || [];
  if (githubMatches.length > 0) {
    return cleanDeployCandidate(githubMatches[0] || '');
  }

  const localMatches = input.match(LOCAL_PROJECT_PATH_RE) || [];
  if (localMatches.length > 0) {
    const best = localMatches.sort((a, b) => b.length - a.length)[0];
    return best ? cleanDeployCandidate(best) : null;
  }

  return knownPaths.length > 0 ? knownPaths[knownPaths.length - 1] || null : null;
}

function toolCallSummary(name: string, args: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    local_list_directory: '检查本地目录',
    local_read_file: '读取本地文件',
    local_write_file: '写入本地文件',
    local_exec: '执行本地命令',
    remote_exec: '执行远程命令',
    remote_list_directory: '检查远程目录',
    remote_read_file: '读取远程文件',
    remote_write_file: '写入远程文件',
    remote_upload_file: '上传文件到远程',
    remote_download_file: '下载远程文件',
    http_probe: '探测 HTTP 地址',
    service_inspect: '检查服务状态',
    service_control: '控制服务',
    git_clone_remote: '远程克隆仓库',
    git_fetch_remote: '远程更新仓库',
  };
  const label = labels[name] || name;
  const mainArg = typeof args.command === 'string'
    ? args.command
    : typeof args.path === 'string'
      ? args.path
      : typeof args.remotePath === 'string'
        ? `${typeof args.localPath === 'string' ? args.localPath : 'local'} -> ${args.remotePath}`
        : typeof args.repoUrl === 'string'
          ? args.repoUrl
          : '';
  return mainArg ? `${label}: ${mainArg}` : label;
}

function makeArtifact(title: string, content: string): AgentArtifact {
  const id = `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title,
    preview: makeArtifactPreview(content),
    content,
    createdAt: Date.now(),
  };
}

function phaseToPlanStatus(run: TaskRunSummary): AgentPlanPhase {
  if (run.status === 'completed') return 'done';
  if (run.status === 'retryable_paused' || run.status === 'paused') return 'paused';
  if (run.status === 'failed') return 'stopped';
  if (run.phase === 'understand' || run.phase === 'inspect' || run.phase === 'hypothesize') return 'generating';
  return 'executing';
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export class AgentManager {
  private sessions = new Map<string, AgentThreadSession>();
  private hypothesisPlanner = new HypothesisPlanner();
  private toolRegistry;
  private repoInspector;

  constructor(private sshMgr: SSHManager) {
    this.toolRegistry = createAgentToolRegistry(sshMgr);
    this.repoInspector = new AgentRepoInspector(sshMgr);
  }

  startPlan(sessionId: string, input: StartAgentInput, webContents: WebContents) {
    this.runEntry(sessionId, {
      connectionId: input.connectionId || sessionId,
      goal: input.goal,
      profile: input.profile,
      sshHost: input.sshHost,
      webContents,
      threadMessages: input.threadMessages,
      restoredRuntime: input.restoredRuntime,
      resetPlan: true,
    }).catch((error) => this.handleFatalError(sessionId, error, false));
  }

  resume(sessionId: string, input: ResumeAgentInput, webContents: WebContents) {
    this.runEntry(sessionId, {
      connectionId: input.connectionId || this.sessions.get(sessionId)?.connectionId || sessionId,
      goal: input.userInput,
      profile: input.profile,
      sshHost: input.sshHost,
      webContents,
      threadMessages: input.threadMessages,
      restoredRuntime: input.restoredRuntime,
      resetPlan: false,
    }).catch((error) => this.handleFatalError(sessionId, error, true));
  }

  stop(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.aborted = true;
    session.running = false;
    session.abortController?.abort();
    if (session.connectionId) {
      // Route execution now lives inside the task runtime, so stopping the task
      // only needs to abort the current agent loop.
    }
    this.emitPlanUpdate(session, 'stopped');
  }

  cleanup(sessionId: string) {
    this.stop(sessionId);
    this.sessions.delete(sessionId);
  }

  private async runEntry(
    sessionId: string,
    options: {
      connectionId: string;
      goal: string;
      profile: LLMProfile;
      sshHost?: string;
      webContents: WebContents;
      threadMessages?: AgentRuntimeMessage[];
      restoredRuntime?: AgentSessionRuntime | null;
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
    session.turnCounter = 0;
    session.consecutiveFailures = 0;

    const resumingGoal = isContinueIntent(options.goal);
    const previousGoal = session.activeTaskRun?.goal || session.planState.global_goal;
    const effectiveGoal = resumingGoal && previousGoal ? previousGoal : options.goal.trim();

    if (options.resetPlan && !resumingGoal) {
      session.planState = createPlanState(effectiveGoal);
      session.history = summarizeThreadMessages(options.threadMessages);
    } else if (!resumingGoal) {
      session.planState.global_goal = effectiveGoal;
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

    this.captureKnownProjectPaths(session, effectiveGoal);
    this.historyPush(session, { role: 'user', content: options.goal });

    const handled = await this.runTaskLoop(session, effectiveGoal, resumingGoal);
    session.running = false;
    const phase = handled && session.activeTaskRun
      ? phaseToPlanStatus(session.activeTaskRun)
      : handled
        ? 'done'
        : 'stopped';
    this.emitPlanUpdate(session, session.aborted ? 'stopped' : phase);
  }

  private async ensureSession(
    sessionId: string,
    options: {
      connectionId: string;
      goal: string;
      profile: LLMProfile;
      sshHost?: string;
      webContents: WebContents;
      restoredRuntime?: AgentSessionRuntime | null;
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
    const restored = options.restoredRuntime;
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
      compressedMemory: restored?.compressedMemory || '',
      artifacts: new Map(),
      contextWindow: restored?.contextWindow
        ? {
            ...restored.contextWindow,
            limitTokens: restored.contextWindow.limitTokens || this.estimateContextLimit(options.profile),
          }
        : {
            promptTokens: 0,
            limitTokens: this.estimateContextLimit(options.profile),
            percentUsed: 0,
            compressionCount: 0,
            autoCompressed: false,
            summaryChars: 0,
          },
      planState: restored?.planState || createPlanState(options.goal),
      localContext,
      knownProjectPaths: restored?.knownProjectPaths || [],
      activeDeployRunId: restored?.activeDeployRunId,
      activeDeploySource: restored?.activeDeploySource,
      activeRunId: restored?.activeRunId,
      activeTaskRun: restored?.activeTaskRun || null,
      resumeRequested: false,
      recentHttpProbes: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private async runTaskLoop(session: AgentThreadSession, goal: string, resumeRequested: boolean): Promise<boolean> {
    if (resumeRequested && session.activeTaskRun && !['completed', 'failed'].includes(session.activeTaskRun.status)) {
      session.resumeRequested = true;
      return this.runDeploymentTask(session, goal, true);
    }

    if (DEPLOY_INTENT_RE.test(goal)) {
      session.resumeRequested = false;
      return this.runDeploymentTask(session, goal, false);
    }

    session.resumeRequested = false;
    return this.runGenericTask(session, goal);
  }

  private async runDeploymentTask(session: AgentThreadSession, goal: string, resumeRequested: boolean): Promise<boolean> {
    const continuingRun =
      resumeRequested &&
      Boolean(session.activeTaskRun) &&
      !['completed', 'failed'].includes(session.activeTaskRun?.status || '');

    const sourceLabel = continuingRun
      ? session.activeTaskRun?.source?.label || session.activeDeploySource || extractDeploySource(goal, session.knownProjectPaths)
      : extractDeploySource(goal, session.knownProjectPaths);

    if (!sourceLabel) {
      return false;
    }

    if (!continuingRun) {
      session.activeTaskRun = this.createTaskRun(goal, sourceLabel);
      session.activeRunId = session.activeTaskRun.id;
      session.activeDeploySource = sourceLabel;
      session.activeDeployRunId = undefined;
      session.recentHttpProbes = [];
      session.lastToolFailure = undefined;
      this.emitAssistantMessage(session, {
        id: `task-run-${Date.now()}`,
        role: 'assistant',
        content: '收到任务目标。我会先分析仓库和服务器环境，建立候选路线，再自己执行、验证并自动修复。',
        timestamp: now(),
      });
    } else {
      session.lastToolFailure = undefined;
      this.emitAssistantMessage(session, {
        id: `task-resume-${Date.now()}`,
        role: 'assistant',
        content: '继续恢复当前任务。我会沿用已确认事实、当前路线和失败记录继续推进。',
        timestamp: now(),
      });
    }

    this.syncPlanFromTaskRun(session);
    this.emitPlanUpdate(session, phaseToPlanStatus(session.activeTaskRun!));

    try {
      if (!continuingRun || !session.activeTaskRun?.repoAnalysis || !session.activeTaskRun?.hypotheses.length) {
        this.upsertTaskRun(session, {
          phase: 'inspect',
          status: 'running',
          currentAction: /^https?:\/\/github\.com\//i.test(sourceLabel)
            ? '在服务器侧 checkout 仓库并读取 README、构建文件、容器与运行时线索'
            : '分析本地项目文件、README、构建入口和运行方式',
        }, {
          phase: 'inspect',
          nextAction: '分析源码与服务器环境',
        });

        const stopInspectHeartbeat = this.startTaskHeartbeat(
          session,
          () => /^https?:\/\/github\.com\//i.test(sourceLabel)
            ? '仍在服务器侧读取仓库结构、README 和构建线索'
            : '仍在分析本地项目文件和构建入口',
        );
        const analysis = await this.repoInspector.analyze(session.connectionId, {
          projectRoot: sourceLabel,
          source: /^https?:\/\/github\.com\//i.test(sourceLabel)
            ? { type: 'github', url: sourceLabel }
            : { type: 'local', path: sourceLabel },
        }).finally(() => stopInspectHeartbeat());
        const repoAnalysis = buildRepoAnalysis(analysis);
        const hypotheses = this.hypothesisPlanner.build(analysis.projectSpec, analysis.serverSpec, repoAnalysis);
        const knownFacts = summarizeKnownFacts(analysis.projectSpec, analysis.serverSpec);

        this.upsertTaskRun(session, {
          repoAnalysis,
          hypotheses,
          phase: 'hypothesize',
          status: 'running',
          currentAction: hypotheses.length
            ? `已建立 ${hypotheses.length} 条候选路线，优先尝试 ${hypotheses[0]?.kind}`
            : '候选路线生成完成',
        }, {
          phase: 'hypothesize',
          knownFacts,
          completedActions: ['source-resolved', 'repo-analyzed', 'server-probed'],
          nextAction: hypotheses[0] ? `尝试 ${hypotheses[0].kind}` : undefined,
        });

        session.planState.scratchpad = appendScratchpad(
          session.planState.scratchpad,
          `Repo analysis: ${repoAnalysis.framework}/${repoAnalysis.language} (${Math.round(repoAnalysis.confidence * 100)}%)`,
        );
        this.emitAssistantMessage(session, {
          id: `route-plan-${Date.now()}`,
          role: 'assistant',
          content: hypotheses.length
            ? `已建立候选路线：${hypotheses.map((item) => item.kind).join(' → ')}。当前先尝试 ${hypotheses[0]?.kind}。`
            : '仓库线索仍然有限，我会先从最可能的路线继续验证。',
          timestamp: now(),
        });
      }

      const currentRun = session.activeTaskRun!;
      const startIndex = Math.max(
        0,
        currentRun.activeHypothesisId ? currentRun.hypotheses.findIndex((item) => item.id === currentRun.activeHypothesisId) : 0,
      );

      for (let index = startIndex; index < currentRun.hypotheses.length; index += 1) {
        const route = session.activeTaskRun?.hypotheses[index];
        if (!route) continue;
        this.upsertTaskRun(session, {
          phase: session.activeTaskRun!.attemptCount > 0 ? 'repair' : 'act',
          status: session.activeTaskRun!.attemptCount > 0 ? 'repairing' : 'running',
          activeHypothesisId: route.id,
          currentAction:
            session.activeTaskRun!.attemptCount > 0 && session.activeTaskRun?.activeHypothesisId === route.id
              ? `恢复 ${route.kind} 路线继续执行与修复`
              : `尝试路线 ${route.kind}`,
        }, {
          phase: session.activeTaskRun!.attemptCount > 0 ? 'repair' : 'act',
          activeHypothesisId: route.id,
          nextAction: `执行 ${route.kind}`,
        });

        this.emitAssistantMessage(session, {
          id: `route-${Date.now()}-${index}`,
          role: 'assistant',
          content: `当前路线：${route.kind}。依据：${route.evidence.slice(0, 2).join('；') || route.summary}`,
          timestamp: now(),
        });

        const stopRouteHeartbeat = this.startTaskHeartbeat(
          session,
          () => `仍在执行 ${route.kind} 路线`,
        );
        const result = await this.executeRouteAutonomously(session, route)
          .finally(() => stopRouteHeartbeat());

        if (result.ok) {
          this.upsertTaskRun(session, {
            status: 'completed',
            phase: 'complete',
            activeHypothesisId: route.id,
            finalUrl: result.finalUrl,
            currentAction: '外部访问验证通过，任务完成',
            attemptCount: Math.max(session.activeTaskRun!.attemptCount, result.attemptCount),
          }, {
            phase: 'complete',
            activeHypothesisId: route.id,
            completedActions: Array.from(new Set([
              ...session.activeTaskRun!.checkpoint.completedActions,
              `route:${route.kind}`,
              'verify:ok',
            ])),
            nextAction: undefined,
          });
          session.activeDeploySource = undefined;
          const successText = `任务完成，访问地址：${result.finalUrl || session.sshHost}。路线：${route.kind}。`;
          this.historyPush(session, { role: 'assistant', content: successText });
          this.emitAssistantMessage(session, {
            id: `task-success-${Date.now()}`,
            role: 'assistant',
            content: successText,
            timestamp: now(),
          });
          return true;
        }

        const attempt = (session.activeTaskRun?.attemptCount || 0) + 1;
        const failure: TaskRunFailure = {
          attempt,
          routeId: route.id,
          failureClass: result.failureClass || 'unknown',
          message: result.failureMessage || 'unknown error',
          timestamp: now(),
        };
        const failureHistory = [...(session.activeTaskRun?.failureHistory || []), failure].slice(-20);
        this.upsertTaskRun(session, {
          status: attempt >= MAX_AUTONOMOUS_REPAIRS ? 'failed' : 'repairing',
          phase: attempt >= MAX_AUTONOMOUS_REPAIRS ? 'failed' : 'repair',
          attemptCount: attempt,
          failureHistory,
          currentAction: this.failureText(failure, false),
        }, {
          phase: attempt >= MAX_AUTONOMOUS_REPAIRS ? 'failed' : 'repair',
          attemptCount: attempt,
          activeHypothesisId: route.id,
          nextAction: attempt >= MAX_AUTONOMOUS_REPAIRS
            ? undefined
            : `评估继续 ${route.kind} 或切换到下一条路线`,
        });

        if (attempt >= MAX_AUTONOMOUS_REPAIRS) {
          const failureText = this.failureText(failure, true);
          this.historyPush(session, { role: 'assistant', content: failureText });
          this.emitAssistantMessage(session, {
            id: `task-exhausted-${Date.now()}`,
            role: 'assistant',
            content: failureText,
            timestamp: now(),
            isError: true,
          });
          return true;
        }

        const shouldSwitch = index < session.activeTaskRun!.hypotheses.length - 1
          && this.shouldSwitchRoute(route, result.failureClass);
        if (shouldSwitch) {
          this.emitAssistantMessage(session, {
            id: `route-switch-${Date.now()}`,
            role: 'assistant',
            content: `当前路线 ${route.kind} 没能自证成功，我会切到下一条候选路线继续完成任务。`,
            timestamp: now(),
          });
          continue;
        }

        this.emitAssistantMessage(session, {
          id: `route-repair-${Date.now()}`,
          role: 'assistant',
          content: `当前路线 ${route.kind} 仍有修复空间，我会继续自动推进第 ${attempt + 1}/5 轮修复。`,
          timestamp: now(),
        });
        index -= 1;
        continue;
      }

      const lastFailure = session.activeTaskRun?.failureHistory[session.activeTaskRun.failureHistory.length - 1];
      const finalFailureText = this.failureText(lastFailure, true);
      this.upsertTaskRun(session, {
        status: 'failed',
        phase: 'failed',
        currentAction: finalFailureText,
      }, {
        phase: 'failed',
        nextAction: undefined,
      });
      this.emitAssistantMessage(session, {
        id: `task-failed-${Date.now()}`,
        role: 'assistant',
        content: finalFailureText,
        timestamp: now(),
        isError: true,
      });
      return true;
    } catch (error: any) {
      const failure: TaskRunFailure = {
        attempt: Math.max((session.activeTaskRun?.attemptCount || 0) + 1, 1),
        routeId: session.activeTaskRun?.activeHypothesisId,
        failureClass: /429|ServerOverloaded|TooManyRequests/i.test(error?.message || '') ? 'llm_overloaded' : 'unknown',
        message: error?.message || String(error),
        timestamp: now(),
      };
      const paused = failure.failureClass === 'llm_overloaded';
      const failureHistory = [...(session.activeTaskRun?.failureHistory || []), failure].slice(-20);
      this.upsertTaskRun(session, {
        status: paused ? 'retryable_paused' : 'failed',
        phase: paused ? 'paused' : 'failed',
        attemptCount: Math.max(session.activeTaskRun?.attemptCount || 0, failure.attempt),
        failureHistory,
        currentAction: this.failureText(failure, true),
      }, {
        phase: paused ? 'paused' : 'failed',
        attemptCount: Math.max(session.activeTaskRun?.attemptCount || 0, failure.attempt),
        nextAction: paused ? '继续恢复当前任务' : undefined,
      });
      this.emitAssistantMessage(session, {
        id: `task-run-error-${Date.now()}`,
        role: 'assistant',
        content: this.failureText(failure, true),
        timestamp: now(),
        isError: true,
      });
      return true;
    } finally {
      session.resumeRequested = false;
    }
  }

  private async executeRouteAutonomously(
    session: AgentThreadSession,
    route: RouteHypothesis,
  ): Promise<RouteExecutionResult> {
    const maxRouteTurns = 12;
    let turns = 0;

    session.planState.scratchpad = appendScratchpad(
      session.planState.scratchpad,
      `Current route: ${route.kind} | Evidence: ${route.evidence.join(' | ') || route.summary}`,
    );

    while (!session.aborted && turns < maxRouteTurns) {
      turns += 1;
      session.turnCounter += 1;
      this.compactHistoryIfNeeded(session);
      this.emitPlanUpdate(session, 'executing');

      const response = await this.callLLMWithRetries(session);
      this.updateContextWindow(session, response.usage);

      const text = response.content?.trim() || '';
      if (text) {
        this.emitAssistantMessage(session, {
          id: `route-think-${Date.now()}-${turns}`,
          role: 'assistant',
          content: text,
          timestamp: now(),
          usage: response.usage,
          modelUsed: response.modelUsed,
        });
      }

      if (!response.toolCalls?.length) {
        if (text) {
          this.historyPush(session, { role: 'assistant', content: text });
        }
        const verifiedUrl = this.detectVerifiedUrl(session, text);
        if (verifiedUrl) {
          return {
            ok: true,
            finalUrl: verifiedUrl,
            attemptCount: session.activeTaskRun?.attemptCount || 0,
          };
        }
        return {
          ok: false,
          failureClass: this.classifyAutonomousFailure(text, session.lastToolFailure?.message),
          failureMessage: text || session.lastToolFailure?.message || 'Route stopped before external verification',
          attemptCount: session.activeTaskRun?.attemptCount || 0,
        };
      }

      this.historyPush(session, {
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        if (session.aborted) break;
        const result = await this.executeToolCall(session, toolCall);
        if (!result.ok && session.consecutiveFailures >= 4) {
          return {
            ok: false,
            failureClass: this.classifyAutonomousFailure(result.content, result.content),
            failureMessage: result.content,
            attemptCount: session.activeTaskRun?.attemptCount || 0,
          };
        }
      }
    }

    const verifiedUrl = this.detectVerifiedUrl(session);
    if (verifiedUrl) {
      return {
        ok: true,
        finalUrl: verifiedUrl,
        attemptCount: session.activeTaskRun?.attemptCount || 0,
      };
    }

    return {
      ok: false,
      failureClass: this.classifyAutonomousFailure(undefined, session.lastToolFailure?.message),
      failureMessage: session.lastToolFailure?.message || `Route ${route.kind} reached the autonomous turn budget before verification`,
      attemptCount: session.activeTaskRun?.attemptCount || 0,
    };
  }

  private async runGenericTask(session: AgentThreadSession, goal: string): Promise<boolean> {
    session.planState.global_goal = goal;
    session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, `Goal: ${goal}`);
    this.emitPlanUpdate(session, 'generating');

    let completed = false;
    try {
      while (!session.aborted && session.turnCounter < MAX_GENERIC_TURNS) {
        session.turnCounter += 1;
        this.compactHistoryIfNeeded(session);
        this.emitPlanUpdate(session, 'executing');

        const response = await this.callLLMWithRetries(session);
        this.updateContextWindow(session, response.usage);

        if (response.content?.trim()) {
          const text = response.content.trim();
          this.emitAssistantMessage(session, {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: text,
            timestamp: now(),
            usage: response.usage,
            modelUsed: response.modelUsed,
          });
          if (!response.toolCalls?.length) {
            this.historyPush(session, { role: 'assistant', content: text });
          }
        }

        if (!response.toolCalls?.length) {
          completed = true;
          return true;
        }

        this.historyPush(session, {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls,
        });

        for (const toolCall of response.toolCalls) {
          if (session.aborted) break;
          await this.executeToolCall(session, toolCall);
        }
      }

      const limitMessage = '已达到当前任务的自动执行轮次上限。我保留了上下文，你可以继续让我接着做。';
      this.historyPush(session, { role: 'assistant', content: limitMessage });
      this.emitAssistantMessage(session, {
        id: `limit-${Date.now()}`,
        role: 'assistant',
        content: limitMessage,
        timestamp: now(),
        isError: true,
      });
      return true;
    } finally {
      this.emitPlanUpdate(session, session.aborted ? 'stopped' : completed ? 'done' : 'stopped');
    }
  }

  private async callLLMWithRetries(session: AgentThreadSession) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await callLLMWithTools(
          session.profile,
          this.buildConversation(session),
          this.toolRegistry.definitions,
          {
            temperature: 0.2,
            maxTokens: 2048,
            signal: session.abortController?.signal,
          },
        );
      } catch (error: any) {
        const retryable = error instanceof LLMRequestError
          ? error.retryable
          : /(429|ServerOverloaded|TooManyRequests|temporarily overloaded|繁忙)/i.test(error?.message || '');
        if (!retryable || attempt >= maxAttempts || session.aborted) {
          throw error;
        }
        const waitMs = 1200 * attempt;
        session.planState.scratchpad = appendScratchpad(
          session.planState.scratchpad,
          `AI service busy, retry ${attempt}/${maxAttempts} after ${waitMs}ms`,
        );
        await this.sleep(waitMs, session.abortController?.signal);
      }
    }
    throw new Error('AI service retry failed');
  }

  private sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      const onAbort = () => {
        cleanup();
        reject(new Error('Agent aborted'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private buildConversation(session: AgentThreadSession): LLMMessage[] {
    const artifactSummaries = Array.from(session.artifacts.values())
      .slice(-4)
      .map((artifact) => ({
        role: 'system',
        content: `Artifact memory:\n${artifact.id}\n${artifact.title}\n${clip(artifact.preview, 800)}`,
      }));

    return [
      { role: 'system', content: buildSystemPrompt(session) },
      ...artifactSummaries,
      ...session.history.slice(-18),
    ];
  }

  private async executeToolCall(session: AgentThreadSession, toolCall: LLMToolCall) {
    const args = safeParseArgs(toolCall.function.arguments);
    const description = toolCallSummary(toolCall.function.name, args);

    const planStep: PlanState['plan'][number] = {
      id: session.planState.plan.length + 1,
      description,
      status: 'in_progress',
      command: description,
    };
    session.planState.plan.push(planStep);
    this.emitPlanUpdate(session, 'executing');
    if (session.activeTaskRun) {
      this.upsertTaskRun(session, {
        currentAction: description,
        phase: this.inferTaskPhaseFromTool(toolCall.function.name),
        status: session.activeTaskRun.status === 'repairing' ? 'repairing' : 'running',
      }, {
        phase: this.inferTaskPhaseFromTool(toolCall.function.name),
        nextAction: description,
      });
    }

    this.emitAssistantMessage(session, {
      id: `tool-call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      content: '',
      timestamp: now(),
      toolCall: {
        name: toolCall.function.name,
        command: description,
        status: 'pending',
      },
    });

    let finalResult: { ok: boolean; content: string };
    try {
      const result = await this.toolRegistry.execute(toolCall.function.name, args, session);
      session.consecutiveFailures = 0;
      session.lastToolFailure = undefined;
      planStep.status = result.ok ? 'completed' : 'failed';
      planStep.command = result.displayCommand;
      planStep.result = result.ok ? clip(result.content, 240) : undefined;
      planStep.error = result.ok ? undefined : clip(result.content, 240);
      session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, result.scratchpadNote);
      this.rememberToolOutcome(session, toolCall.function.name, result);

      const serialized = serializeValue(result.structured);
      const toolContent = serialized.length > 1600 ? this.storeArtifact(session, toolCall.function.name, serialized) : serialized;
      this.historyPush(session, {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolContent,
      });
      this.emitToolResultMessage(session, toolCall.function.name, result.displayCommand, result.content, result.ok);
      finalResult = {
        ok: result.ok,
        content: result.content,
      };
    } catch (error: any) {
      session.consecutiveFailures += 1;
      const errorMessage = error?.message || String(error);
      session.lastToolFailure = {
        name: toolCall.function.name,
        message: errorMessage,
        timestamp: now(),
      };
      planStep.status = 'failed';
      planStep.command = description;
      planStep.error = clip(errorMessage, 240);
      session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, `失败: ${description} -> ${errorMessage}`);
      this.historyPush(session, {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ ok: false, error: errorMessage }),
      });
      this.emitToolResultMessage(session, toolCall.function.name, description, errorMessage, false);

      if (session.consecutiveFailures >= 4) {
        const content = `连续失败次数过多，已停止自动执行。最后错误：${errorMessage}`;
        this.historyPush(session, { role: 'assistant', content });
        this.emitAssistantMessage(session, {
          id: `tool-loop-failed-${Date.now()}`,
          role: 'assistant',
          content,
          timestamp: now(),
          isError: true,
        });
        session.aborted = true;
      }
      finalResult = {
        ok: false,
        content: errorMessage,
      };
    }

    this.emitPlanUpdate(session, 'executing');
    return finalResult;
  }

  private storeArtifact(session: AgentThreadSession, title: string, content: string) {
    const artifact = makeArtifact(title, content);
    session.artifacts.set(artifact.id, artifact);
    return JSON.stringify({
      ok: true,
      artifactId: artifact.id,
      title: artifact.title,
      preview: artifact.preview,
    });
  }

  private estimateContextLimit(profile: LLMProfile) {
    const model = `${profile.provider}:${profile.model}`.toLowerCase();
    if (/(gpt-5|gpt-4\.1|claude|deepseek|qwen|gemini)/.test(model)) return 256000;
    if (/(mini|haiku|small)/.test(model)) return 128000;
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

  private compactHistoryIfNeeded(session: AgentThreadSession) {
    const historyTooLong = session.history.length > 20;
    const promptNearLimit = session.contextWindow.promptTokens >= session.contextWindow.limitTokens * 0.72;
    if (!historyTooLong && !promptNearLimit) return;
    if (session.history.length <= 10) return;

    const older = session.history.slice(0, -10);
    const newer = session.history.slice(-10);
    const summary = [
      `Goal: ${session.planState.global_goal}`,
      session.activeTaskRun ? `Active run: ${session.activeTaskRun.phase}/${session.activeTaskRun.status}` : '',
      older
        .map((message) => `${message.role}: ${clip(String(message.content || ''), 200)}`)
        .filter(Boolean)
        .join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n');

    session.compressedMemory = clip(
      session.compressedMemory ? `${session.compressedMemory}\n\n${summary}` : summary,
      6000,
    );
    session.history = newer;
    session.contextWindow = {
      ...session.contextWindow,
      compressionCount: session.contextWindow.compressionCount + 1,
      autoCompressed: true,
      summaryChars: session.compressedMemory.length,
    };
    session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, 'Context auto-compressed');
  }

  private createTaskRun(goal: string, sourceLabel: string): TaskRunSummary {
    const createdAt = now();
    return {
      id: `task-run-${createdAt}`,
      goal,
      status: 'running',
      phase: 'understand',
      source: {
        type: /^https?:\/\/github\.com\//i.test(sourceLabel) ? 'github' : 'local',
        label: sourceLabel,
      },
      hypotheses: [],
      attemptCount: 0,
      failureHistory: [],
      checkpoint: {
        phase: 'understand',
        completedActions: [],
        knownFacts: [],
        attemptCount: 0,
      },
      currentAction: /^https?:\/\/github\.com\//i.test(sourceLabel)
        ? '准备在服务器侧分析 GitHub 仓库'
        : '准备分析本地项目并部署',
      createdAt,
      updatedAt: createdAt,
    };
  }

  private upsertTaskRun(
    session: AgentThreadSession,
    patch: Partial<TaskRunSummary>,
    checkpointPatch?: Partial<RunCheckpoint>,
  ) {
    if (!session.activeTaskRun) return;
    const checkpoint = {
      ...session.activeTaskRun.checkpoint,
      ...(checkpointPatch || {}),
    };
    session.activeTaskRun = {
      ...session.activeTaskRun,
      ...patch,
      checkpoint,
      updatedAt: now(),
    };
    session.activeRunId = session.activeTaskRun.id;
    this.syncPlanFromTaskRun(session);
    this.emitPlanUpdate(session, phaseToPlanStatus(session.activeTaskRun));
  }

  private syncPlanFromTaskRun(session: AgentThreadSession) {
    const run = session.activeTaskRun;
    if (!run) return;

    const steps = [
      {
        id: 1,
        phase: 'understand',
        description: '理解目标与源码来源',
        result: run.source ? `${run.source.type}: ${run.source.label}` : undefined,
      },
      {
        id: 2,
        phase: 'inspect',
        description: '分析仓库与服务器环境',
        result: run.repoAnalysis
          ? `${run.repoAnalysis.framework}/${run.repoAnalysis.language} · confidence ${Math.round(run.repoAnalysis.confidence * 100)}%`
          : undefined,
      },
      {
        id: 3,
        phase: 'hypothesize',
        description: '建立候选路线假设',
        result: run.hypotheses.length ? run.hypotheses.map((item) => item.kind).join(' → ') : undefined,
      },
      {
        id: 4,
        phase: run.phase === 'repair' ? 'repair' : 'act',
        description: run.activeHypothesisId
          ? `执行路线: ${run.hypotheses.find((item) => item.id === run.activeHypothesisId)?.kind || run.activeHypothesisId}`
          : '执行当前路线',
        command: run.currentAction,
      },
      {
        id: 5,
        phase: 'verify',
        description: '验证外部访问并发布结果',
        result: run.finalUrl,
        error: run.failureHistory[run.failureHistory.length - 1]?.message,
      },
    ];

    const phaseRank: Record<TaskRunSummary['phase'], number> = {
      understand: 1,
      inspect: 2,
      hypothesize: 3,
      act: 4,
      verify: 5,
      repair: 4,
      complete: 5,
      failed: 5,
      paused: 4,
    };
    const currentRank = phaseRank[run.phase];

    session.planState.global_goal = run.goal;
    session.planState.plan = steps.map((item) => {
      let status: PlanState['plan'][number]['status'] = 'pending';
      if (item.id < currentRank) status = 'completed';
      if (item.id === currentRank) {
        status = run.status === 'failed'
          ? 'failed'
          : run.status === 'paused' || run.status === 'retryable_paused'
            ? 'waiting_approval'
            : 'in_progress';
      }
      if (run.status === 'completed') status = 'completed';
      return {
        id: item.id,
        description: item.description,
        status,
        command: item.command,
        result: item.result,
        error: item.error,
      };
    });
    session.planState.scratchpad = run.checkpoint.knownFacts.slice(0, 12).join('\n');
  }

  private inferTaskPhaseFromTool(toolName: string): TaskRunSummary['phase'] {
    if (toolName === 'http_probe' || toolName === 'service_inspect') return 'verify';
    if (toolName.startsWith('git_') || toolName.includes('list_directory') || toolName.includes('read_file')) {
      return 'inspect';
    }
    return 'act';
  }

  private rememberToolOutcome(
    session: AgentThreadSession,
    toolName: string,
    result: { ok: boolean; content: string; structured: Record<string, unknown>; scratchpadNote?: string },
  ) {
    if (
      toolName === 'http_probe'
      && typeof result.structured.url === 'string'
      && typeof result.structured.status === 'number'
    ) {
      session.recentHttpProbes = [
        ...session.recentHttpProbes.slice(-9),
        {
          url: result.structured.url,
          status: result.structured.status,
          timestamp: now(),
        },
      ];
    }

    if (!session.activeTaskRun) return;

    const summary = result.ok
      ? `${toolName}: ${clip(result.content, 120)}`
      : `failed ${toolName}: ${clip(result.content, 120)}`;
    const knownFacts = Array.from(
      new Set([...(session.activeTaskRun.checkpoint.knownFacts || []), summary]),
    ).slice(-18);
    const completedActions = result.ok
      ? Array.from(
          new Set([...(session.activeTaskRun.checkpoint.completedActions || []), toolName]),
        ).slice(-32)
      : session.activeTaskRun.checkpoint.completedActions;

    this.upsertTaskRun(session, {
      currentAction: result.ok ? `已完成 ${toolName}` : `执行失败 ${toolName}`,
    }, {
      knownFacts,
      completedActions,
    });
  }

  private extractUrls(text?: string) {
    if (!text) return [];
    const matches = text.match(/https?:\/\/[^\s"'`<>）)]+/ig) || [];
    return Array.from(new Set(matches.map((item) => item.replace(/[),.;!?]+$/, ''))));
  }

  private detectVerifiedUrl(session: AgentThreadSession, assistantText?: string) {
    const successfulProbes = session.recentHttpProbes.filter((item) => item.status >= 200 && item.status < 400);
    if (successfulProbes.length === 0 && !assistantText) return undefined;

    const candidates = this.extractUrls(assistantText);
    const matchedCandidate = candidates.find((candidate) =>
      successfulProbes.some((probe) => probe.url === candidate),
    );
    if (matchedCandidate) return matchedCandidate;

    if (successfulProbes.length === 1) {
      return successfulProbes[0]?.url;
    }

    return undefined;
  }

  private classifyAutonomousFailure(content?: string, fallback?: string): FailureClass {
    const message = `${content || ''}\n${fallback || ''}`.toLowerCase();
    if (/429|serveroverloaded|toomanyrequests/.test(message)) return 'llm_overloaded';
    if (/not found|no such file|enoent|cannot access/.test(message)) return 'source_checkout_failed';
    if (/docker compose|docker-compose|shorthand flag: 'd' in -d|is not a docker command/.test(message)) {
      return 'compose_variant_mismatch';
    }
    if (/requires node|requires python|requires java|unsupported engine|version mismatch/.test(message)) {
      return 'runtime_version_mismatch';
    }
    if (/command not found|node: not found|python: not found|python3: not found|java: command not found|docker: command not found/.test(message)) {
      return 'runtime_missing';
    }
    if (/connection refused|postgres|mysql|redis|mongodb|kafka/.test(message)) {
      return 'dependency_service_missing';
    }
    if (/address already in use|eaddrinuse|port .* in use/.test(message)) {
      return 'port_conflict';
    }
    if (/nginx|reverse proxy|bad gateway/.test(message)) {
      return 'proxy_failed';
    }
    if (/health|http 404|http 500|no-response|verification/.test(message)) {
      return 'health_check_failed';
    }
    if (/build failed|compilation|npm err|gradle|maven|vite build|bun build|poetry install|pip install/.test(message)) {
      return 'build_failed';
    }
    return 'unknown';
  }

  private shouldSwitchRoute(hypothesis: RouteHypothesis, failureClass?: FailureClass) {
    if (!failureClass) return false;
    if (failureClass === 'llm_overloaded') return false;
    if (failureClass === 'source_checkout_failed') return false;
    if (failureClass === 'runtime_missing' || failureClass === 'runtime_version_mismatch') return false;
    if (failureClass === 'env_missing' || failureClass === 'dependency_service_missing') return false;
    if (hypothesis.kind === 'compose-native' || hypothesis.kind === 'dockerfile-native') {
      return failureClass === 'health_check_failed' || failureClass === 'unknown';
    }
    return ['build_failed', 'service_boot_failed', 'health_check_failed', 'unknown'].includes(failureClass);
  }

  private failureText(failure?: TaskRunFailure, includeContinue = false) {
    if (!failure) {
      return includeContinue
        ? '任务还没完成，当前状态已保留，你可以发送“继续”恢复当前任务。'
        : '任务还没完成。';
    }
    const detail = [failure.failureClass, failure.message].filter(Boolean).join(': ');
    return includeContinue
      ? `任务还没完成。当前失败原因：${detail}。你可以发送“继续”恢复当前任务。`
      : `当前失败原因：${detail}`;
  }

  private captureKnownProjectPaths(session: AgentThreadSession, input: string) {
    const localMatches = input.match(LOCAL_PROJECT_PATH_RE) || [];
    for (const match of localMatches) {
      const normalized = match.includes('\\') ? path.normalize(match.trim()) : match.trim();
      if (normalized && !session.knownProjectPaths.includes(normalized)) {
        session.knownProjectPaths.push(normalized);
      }
    }

    const githubMatches = input.match(GITHUB_PROJECT_URL_RE) || [];
    for (const match of githubMatches) {
      const normalized = cleanDeployCandidate(match);
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

  private emitPlanUpdate(session: AgentThreadSession, planPhase: AgentPlanPhase | string) {
    if (session.webContents.isDestroyed()) return;
    session.webContents.send('agent-plan-update', {
      sessionId: session.id,
      planState: session.planState,
      planPhase,
      contextWindow: session.contextWindow,
      compressedMemory: session.compressedMemory,
      knownProjectPaths: session.knownProjectPaths,
      activeDeployRunId: session.activeDeployRunId,
      activeDeploySource: session.activeDeploySource,
      activeRunId: session.activeRunId,
      activeTaskRun: session.activeTaskRun,
    });
  }

  private emitAssistantMessage(session: AgentThreadSession, message: AgentRuntimeMessage) {
    if (session.webContents.isDestroyed()) return;
    session.webContents.send('agent-push-msg', { sessionId: session.id, message });
  }

  private emitToolResultMessage(
    session: AgentThreadSession,
    toolName: string,
    command: string,
    content: string,
    ok: boolean,
  ) {
    this.emitAssistantMessage(session, {
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
    });
  }

  private startTaskHeartbeat(
    session: AgentThreadSession,
    describe: () => string,
    intervalMs = 15000,
  ) {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (session.aborted || !session.running || !session.activeTaskRun) return;
      const elapsed = formatElapsed(Date.now() - startedAt);
      this.upsertTaskRun(session, {
        currentAction: `${describe()} · 已持续 ${elapsed}`,
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }

  private handleFatalError(sessionId: string, error: unknown, fromResume: boolean) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.running = false;
    const content = `${fromResume ? '继续执行失败' : '执行失败'}：${error instanceof Error ? error.message : String(error)}`;
    this.historyPush(session, { role: 'assistant', content });
    this.emitAssistantMessage(session, {
      id: `agent-error-${Date.now()}`,
      role: 'assistant',
      content,
      timestamp: now(),
      isError: true,
    });
    this.emitPlanUpdate(session, 'stopped');
  }
}
