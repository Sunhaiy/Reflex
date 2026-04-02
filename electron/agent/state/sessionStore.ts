import path from 'path';
import { promises as fs } from 'fs';
import type { WebContents } from 'electron';
import type { LLMMessage, LLMProfile } from '../../llm.js';
import type { FailureClass } from '../../../src/shared/deployTypes.js';
import type {
  ChildTaskSummary,
  AgentMemoryFileSummary,
  AgentPlanPhase,
  AgentSessionRuntime,
  AgentCompactState,
  RouteHypothesis,
  RunCheckpoint,
  TaskTodoItem,
  TaskRunFailure,
  TaskRunSummary,
} from '../../../src/shared/types.js';
import { SSHManager } from '../../ssh/sshManager.js';
import { appendScratchpad, summarizeThreadMessages } from '../prompts.js';
import { buildLocalContext, probeRemoteContext } from '../toolRegistry.js';
import type { AgentRuntimeMessage, AgentThreadSession } from '../types.js';
import { AgentEventBus } from '../runtime/eventBus.js';
import { AgentMemoryLoader } from '../memory/memoryLoader.js';
import { AgentTranscriptStore } from './transcriptStore.js';
import {
  GITHUB_PROJECT_URL_RE,
  LOCAL_PROJECT_PATH_RE,
  buildTaskRunId,
  cleanDeployCandidate,
  clip,
  createPlanState,
  extractDeploySource,
  isContinueIntent,
  normalizePathCandidate,
  now,
  phaseToPlanStatus,
} from '../runtime/helpers.js';
interface EnsureSessionOptions {
  connectionId: string;
  goal: string;
  profile: LLMProfile;
  sshHost?: string;
  webContents: WebContents;
  restoredRuntime?: AgentSessionRuntime | null;
}

export class AgentSessionStore {
  private sessions = new Map<string, AgentThreadSession>();
  private memoryLoader = new AgentMemoryLoader();
  private transcriptStore = new AgentTranscriptStore();

  constructor(
    private sshMgr: SSHManager,
    private events: AgentEventBus,
  ) {}

  get(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  async ensureSession(sessionId: string, options: EnsureSessionOptions): Promise<AgentThreadSession> {
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
    const seededHistory = restored?.compressedMemory
      ? []
      : await this.transcriptStore.loadRecentMessages(sessionId, 10);
    const recentProgress = restored?.compressedRunMemory
      ? []
      : await this.transcriptStore.loadRecentProgress(sessionId, 8);
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
      history: seededHistory,
      compressedMemory: restored?.compressedMemory || '',
      compressedRunMemory: restored?.compressedRunMemory || clip(recentProgress.join('\n'), 3200),
      memoryPrompt: '',
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
      memoryFiles: restored?.memoryFiles || [],
      taskTodos: restored?.taskTodos || [],
      compactState: restored?.compactState || {
        lastBoundaryMessageCount: 0,
        consecutiveFailures: 0,
        paused: false,
      },
      activeRunId: restored?.activeRunId,
      activeTaskRun: restored?.activeTaskRun
        ? {
            ...restored.activeTaskRun,
            childRuns: restored.activeTaskRun.childRuns || [],
            taskTodos: restored.activeTaskRun.taskTodos || restored?.taskTodos || this.createDefaultTodos(),
          }
        : null,
      resumeRequested: false,
      recentHttpProbes: [],
      lastToolFailure: undefined,
    };
    const initialProjectPath = this.pickLikelyProjectPath(session.knownProjectPaths);
    await this.refreshMemory(session, initialProjectPath);
    this.sessions.set(sessionId, session);
    return session;
  }

  stop(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.aborted = true;
    session.running = false;
    session.abortController?.abort();
    this.events.emitPlanUpdate(session, 'stopped');
  }

  cleanup(sessionId: string) {
    this.stop(sessionId);
    this.sessions.delete(sessionId);
  }

  async beginRun(
    session: AgentThreadSession,
    options: {
      goal: string;
      resetPlan: boolean;
      threadMessages?: AgentRuntimeMessage[];
    },
  ) {
    const resumingGoal = isContinueIntent(options.goal);
    const previousGoal = session.activeTaskRun?.goal || session.planState.global_goal;
    const effectiveGoal = resumingGoal && previousGoal ? previousGoal : options.goal.trim();

    if (options.resetPlan && !resumingGoal) {
      session.planState = createPlanState(effectiveGoal);
      session.history = summarizeThreadMessages(options.threadMessages);
    } else if (!resumingGoal) {
      session.planState.global_goal = effectiveGoal;
    }

    const remoteHost = session.sshHost || this.sshMgr.getConnectionConfig(session.connectionId)?.host || 'server';
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
    await this.refreshMemory(session, this.pickLikelyProjectPath(session.knownProjectPaths));
    this.historyPush(session, { role: 'user', content: options.goal });
    return {
      effectiveGoal,
      resumeRequested: resumingGoal,
    };
  }

  historyPush(session: AgentThreadSession, message: LLMMessage) {
    session.history.push(message);
    if (session.history.length > 24) {
      session.history = session.history.slice(-24);
    }
    void this.transcriptStore.appendMessage(session.id, message);
  }

  estimateContextLimit(profile: LLMProfile) {
    const model = `${profile.provider}:${profile.model}`.toLowerCase();
    if (/(gpt-5|gpt-4\.1|claude|deepseek|qwen|gemini)/.test(model)) return 256000;
    if (/(mini|haiku|small)/.test(model)) return 128000;
    return 128000;
  }

  updateContextWindow(
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

  compactHistoryIfNeeded(session: AgentThreadSession) {
    const historyTooLong = session.history.length > 20;
    const promptNearLimit = session.contextWindow.promptTokens >= session.contextWindow.limitTokens * 0.72;
    if (!historyTooLong && !promptNearLimit) return;
    if (session.history.length <= 10) return;

    const older = session.history.slice(0, -10);
    const newer = session.history.slice(-10);
    const activeRoute = session.activeTaskRun?.activeHypothesisId
      ? session.activeTaskRun?.hypotheses.find((item) => item.id === session.activeTaskRun?.activeHypothesisId)?.kind
      : undefined;
    const recentFailure = session.activeTaskRun?.failureHistory[session.activeTaskRun.failureHistory.length - 1];
    const todoSummary = (session.activeTaskRun?.taskTodos || session.taskTodos || [])
      .map((todo) => `- [${todo.status}] ${todo.content}`)
      .join('\n');
    const summary = [
      `Goal: ${session.planState.global_goal}`,
      session.activeTaskRun ? `Active run: ${session.activeTaskRun.phase}/${session.activeTaskRun.status}` : '',
      activeRoute ? `Active route: ${activeRoute}` : '',
      recentFailure ? `Recent failure: ${recentFailure.failureClass}: ${clip(recentFailure.message, 320)}` : '',
      session.activeTaskRun?.checkpoint.nextAction ? `Next action: ${session.activeTaskRun.checkpoint.nextAction}` : '',
      todoSummary ? `Open todos:\n${todoSummary}` : '',
      'Conversation handoff:',
      older
        .map((message) => `${message.role}: ${clip(String(message.content || ''), 200)}`)
        .filter(Boolean)
        .join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n');

    session.compressedRunMemory = clip([
      session.activeTaskRun ? `Run goal: ${session.activeTaskRun.goal}` : '',
      activeRoute ? `Route: ${activeRoute}` : '',
      session.activeTaskRun?.checkpoint.knownFacts.length
        ? `Known facts:\n${session.activeTaskRun.checkpoint.knownFacts.slice(-8).map((item) => `- ${item}`).join('\n')}`
        : '',
      todoSummary ? `Todos:\n${todoSummary}` : '',
      session.activeTaskRun?.checkpoint.nextAction ? `Next action: ${session.activeTaskRun.checkpoint.nextAction}` : '',
    ].filter(Boolean).join('\n\n'),
      5000,
    );
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

  createTaskRun(goal: string, sourceLabel: string): TaskRunSummary {
    const createdAt = now();
    const taskTodos = this.createDefaultTodos();
    return {
      id: buildTaskRunId(),
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
      taskTodos,
      childRuns: [],
      currentAction: /^https?:\/\/github\.com\//i.test(sourceLabel)
        ? "Analyzing GitHub repository on the remote server"
        : "Analyzing local project files and entry points",
      createdAt,
      updatedAt: createdAt,
    };
  }

  attachTaskRun(session: AgentThreadSession, taskRun: TaskRunSummary) {
    session.activeTaskRun = taskRun;
    session.activeRunId = taskRun.id;
    session.taskTodos = taskRun.taskTodos;
    this.syncPlanFromTaskRun(session);
    void this.transcriptStore.appendTaskSnapshot(session.id, taskRun);
    this.events.emitPlanUpdate(session, phaseToPlanStatus(taskRun));
  }

  upsertTaskRun(
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
    if (patch.taskTodos) {
      session.taskTodos = patch.taskTodos;
    } else if (session.activeTaskRun.taskTodos?.length) {
      session.taskTodos = session.activeTaskRun.taskTodos;
    }
    session.activeRunId = session.activeTaskRun.id;
    this.syncPlanFromTaskRun(session);
    void this.transcriptStore.appendTaskSnapshot(session.id, session.activeTaskRun);
    if (patch.currentAction) {
      void this.transcriptStore.appendProgress(session.id, session.activeTaskRun.id, patch.currentAction);
    }
    this.events.emitPlanUpdate(session, phaseToPlanStatus(session.activeTaskRun));
  }

  createChildRun(
    session: AgentThreadSession,
    input: { title: string; goal: string; mode: ChildTaskSummary['mode'] },
  ) {
    if (!session.activeTaskRun) {
      throw new Error('No active task run');
    }
    const child: ChildTaskSummary = {
      id: `child-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: input.title,
      goal: input.goal,
      mode: input.mode,
      parentRunId: session.activeTaskRun.id,
      lineageKey: `${session.activeTaskRun.id}:${input.mode}:${Date.now()}`,
      parentRoute: session.activeTaskRun.activeHypothesisId
        ? session.activeTaskRun.hypotheses.find((item) => item.id === session.activeTaskRun?.activeHypothesisId)?.kind
        : undefined,
      inheritedMemoryChars: (session.compressedRunMemory || '').length + (session.memoryPrompt || '').length,
      status: 'pending',
      createdAt: now(),
      updatedAt: now(),
    };
    this.upsertTaskRun(session, {
      childRuns: [...session.activeTaskRun.childRuns, child],
    });
    return child;
  }

  updateChildRun(
    session: AgentThreadSession,
    childId: string,
    patch: Partial<ChildTaskSummary>,
  ) {
    if (!session.activeTaskRun) return;
    const childRuns = session.activeTaskRun.childRuns.map((child) => (
      child.id === childId
        ? {
            ...child,
            ...patch,
            updatedAt: now(),
          }
        : child
    ));
    this.upsertTaskRun(session, { childRuns });
    const child = childRuns.find((item) => item.id === childId);
    if (child) {
      void this.transcriptStore.appendSubagentSnapshot(session.id, child);
    }
  }

  syncPlanFromTaskRun(session: AgentThreadSession) {
    const run = session.activeTaskRun;
    if (!run) return;

    const steps = [
      {
        id: 1,
        phase: 'understand',
        description: "Understand task and source",
        result: run.source ? `${run.source.type}: ${run.source.label}` : undefined,
      },
      {
        id: 2,
        phase: 'inspect',
        description: "Inspect repository and server",
        result: run.repoAnalysis
          ? `${run.repoAnalysis.framework}/${run.repoAnalysis.language} · ${Math.round(run.repoAnalysis.confidence * 100)}%`
          : undefined,
      },
      {
        id: 3,
        phase: 'hypothesize',
        description: "Build route hypotheses",
        result: run.hypotheses.length ? run.hypotheses.map((item) => item.kind).join(' -> ') : undefined,
      },
      {
        id: 4,
        phase: run.phase === 'repair' ? 'repair' : 'act',
        description: run.activeHypothesisId
          ? `Executing route ${run.hypotheses.find((item) => item.id === run.activeHypothesisId)?.kind || run.activeHypothesisId}`
          : "Executing current task actions",
        command: run.currentAction,
      },
      {
        id: 5,
        phase: 'verify',
        description: "Verify externally reachable result",
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
    run.taskTodos = this.reconcileTaskTodos(run);
    session.taskTodos = run.taskTodos;

    session.planState.global_goal = run.goal;
    session.planState.plan = steps.map((item) => {
      let status: AgentThreadSession['planState']['plan'][number]['status'] = 'pending';
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

  async refreshMemory(session: AgentThreadSession, projectPath?: string) {
    const memory = await this.memoryLoader.load({
      workspaceRoot: session.localContext.cwd,
      homeDir: session.localContext.homeDir,
      projectPath,
    });
    session.memoryFiles = memory.files;
    session.memoryPrompt = memory.prompt;
  }

  inferTaskPhaseFromTool(toolName: string): TaskRunSummary['phase'] {
    if (toolName === 'http_probe' || toolName === 'service_inspect') return 'verify';
    if (toolName.startsWith('git_') || toolName.includes('list_directory') || toolName.includes('read_file')) {
      return 'inspect';
    }
    return 'act';
  }

  rememberToolOutcome(
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
      currentAction: result.ok ? `Completed ${toolName}` : `Failed ${toolName}`,
    }, {
      knownFacts,
      completedActions,
    });
  }

  detectVerifiedUrl(session: AgentThreadSession, assistantText?: string) {
    const successfulProbes = session.recentHttpProbes.filter((item) => item.status >= 200 && item.status < 400);
    if (successfulProbes.length === 0 && !assistantText) return undefined;

    const candidates = this.extractUrls(assistantText);
    const matchedCandidate = candidates.find((candidate) =>
      successfulProbes.some((probe) => probe.url === candidate),
    );
    if (matchedCandidate) return matchedCandidate;
    if (successfulProbes.length === 1) return successfulProbes[0]?.url;
    return undefined;
  }

  classifyAutonomousFailure(content?: string, fallback?: string): FailureClass {
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

  shouldSwitchRoute(hypothesis: RouteHypothesis, failureClass?: FailureClass) {
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

  failureText(failure?: TaskRunFailure, includeContinue = false) {
    if (!failure) {
      return includeContinue
        ? "Task is not finished yet. Current state is preserved. Send 'continue' to resume the same task."
        : "Task is not finished yet.";
    }
    const detail = [failure.failureClass, failure.message].filter(Boolean).join(": ");
    return includeContinue
      ? `Task is not finished yet. Current failure: ${detail}. Send 'continue' to resume the same task.`
      : `Current failure: ${detail}`;
  }

  captureKnownProjectPaths(session: AgentThreadSession, input: string) {
    const localMatches = input.match(LOCAL_PROJECT_PATH_RE) || [];
    for (const match of localMatches) {
      const normalized = normalizePathCandidate(match);
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

  async resolveDeploySource(session: AgentThreadSession, goal: string) {
    const directMatch = extractDeploySource(goal, session.knownProjectPaths);
    if (directMatch) return directMatch;

    const inferredLocalPath = await this.inferLocalProjectPath(session, goal);
    if (inferredLocalPath) {
      if (!session.knownProjectPaths.includes(inferredLocalPath)) {
        session.knownProjectPaths.push(inferredLocalPath);
      }
      return inferredLocalPath;
    }

    return null;
  }

  pushFatalMessage(session: AgentThreadSession, content: string, fromResume: boolean) {
    const prefix = fromResume ? "Resume failed" : "Execution failed";
    const message = `${prefix}: ${content}`;
    this.historyPush(session, { role: "assistant", content: message });
    this.events.emitAssistantMessage(session, {
      id: `agent-error-${Date.now()}` ,
      role: "assistant",
      content: message,
      timestamp: now(),
      isError: true,
    });
    this.events.emitPlanUpdate(session, "stopped");
  }

  private extractUrls(text?: string) {
    if (!text) return [];
    const matches = text.match(/https?:\/\/[^\s"<>]+/ig) || [];
    return Array.from(new Set(matches.map((item) => item.replace(/[),.;!?]+$/, ""))));
  }

  private async inferLocalProjectPath(session: AgentThreadSession, goal: string) {
    if (GITHUB_PROJECT_URL_RE.test(goal)) return null;

    const candidateNames = this.extractProjectNameCandidates(goal);
    if (!candidateNames.length) return null;

    const searchRoots = Array.from(
      new Set([session.localContext.desktopDir, session.localContext.cwd, session.localContext.homeDir].filter(Boolean)),
    );

    for (const root of searchRoots) {
      const exact = await this.findDirectoryMatch(root, candidateNames, true);
      if (exact) return exact;
    }

    for (const root of searchRoots) {
      const fuzzy = await this.findDirectoryMatch(root, candidateNames, false);
      if (fuzzy) return fuzzy;
    }

    return null;
  }

  private extractProjectNameCandidates(goal: string) {
    const desktopMatches = Array.from(goal.matchAll(/\u684c\u9762\u4e0a(?:\u7684)?([A-Za-z0-9._-]{2,})\u9879\u76ee/gi)).map((match) => match[1]);
    const deployMatches = Array.from(goal.matchAll(/\u90e8\u7f72(?:\u8fd9\u4e2a)?([A-Za-z0-9._-]{2,})\u9879\u76ee/gi)).map((match) => match[1]);
    const tokenMatches = Array.from(goal.matchAll(/\b([A-Za-z0-9._-]{2,})\b/g)).map((match) => match[1]);
    const candidates = [...desktopMatches, ...deployMatches, ...tokenMatches]
      .filter((item): item is string => Boolean(item))
      .map((item) => item.trim());

    const stopWords = new Set([
      "deploy",
      "publish",
      "ship",
      "continue",
      "resume",
      "retry",
      "server",
      "project",
      "desktop",
      "github",
      "https",
      "http",
      "www",
      "com",
      "root",
      "local",
      "remote",
      "please",
    ]);

    return Array.from(new Set(candidates))
      .filter((item) => item.length >= 2)
      .filter((item) => !stopWords.has(item.toLowerCase()))
      .sort((a, b) => b.length - a.length);
  }

  private async findDirectoryMatch(root: string, candidates: string[], exact: boolean) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const candidate of candidates) {
        const normalizedCandidate = candidate.toLowerCase();
        const match = entries.find((entry) => {
          if (!entry.isDirectory()) return false;
          const entryName = entry.name.toLowerCase();
          return exact
            ? entryName === normalizedCandidate
            : entryName.includes(normalizedCandidate) || normalizedCandidate.includes(entryName);
        });
        if (match) {
          return path.join(root, match.name);
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private pickLikelyProjectPath(candidates: string[]) {
    const localPaths = candidates.filter((item) => !/^https?:\/\//i.test(item));
    return localPaths.length ? localPaths[localPaths.length - 1] : undefined;
  }

  private createDefaultTodos(): TaskTodoItem[] {
    return [
      { id: 'understand', content: 'Understand goal and locate the project source', status: 'in_progress' },
      { id: 'inspect', content: 'Inspect repository and server environment', status: 'pending' },
      { id: 'hypothesize', content: 'Build route hypotheses and choose the best route', status: 'pending' },
      { id: 'act', content: 'Execute the selected route', status: 'pending' },
      { id: 'verify', content: 'Verify the externally reachable result', status: 'pending' },
    ];
  }

  private reconcileTaskTodos(run: TaskRunSummary): TaskTodoItem[] {
    const existing = run.taskTodos?.length ? run.taskTodos : this.createDefaultTodos();
    const rankByPhase: Record<TaskRunSummary['phase'], number> = {
      understand: 0,
      inspect: 1,
      hypothesize: 2,
      act: 3,
      repair: 3,
      verify: 4,
      complete: 4,
      failed: 4,
      paused: 3,
    };
    const activeIndex = rankByPhase[run.phase];
    return existing.map((todo, index) => {
      let status: TaskTodoItem['status'] = 'pending';
      if (index < activeIndex) status = 'completed';
      if (index === activeIndex) {
        status = run.status === 'completed' ? 'completed' : 'in_progress';
      }
      if (run.status === 'completed') status = 'completed';
      return { ...todo, status };
    });
  }
}
