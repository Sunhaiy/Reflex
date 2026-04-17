import path from 'path';
import { Dirent, promises as fs } from 'fs';
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
  StrategyDecision,
  StrategyDecisionAction,
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
  isOptionSelection,
  looksLikeDeploymentGoal,
  looksLikeProjectScopedGoal,
  looksLikeSiteFollowUpGoal,
  normalizePathCandidate,
  now,
  phaseToPlanStatus,
  WATCHDOG_STAGNATION_LIMIT,
  WATCHDOG_STALL_MS,
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

  private createCheckpoint(phase: RunCheckpoint['phase'], nextAction?: string): RunCheckpoint {
    const timestamp = now();
    return {
      phase,
      completedActions: [],
      knownFacts: [],
      attemptCount: 0,
      nextAction,
      lastProgressAt: timestamp,
      stagnationCount: 0,
      replayCount: 0,
    };
  }

  private normalizeCheckpoint(
    checkpoint: Partial<RunCheckpoint> | undefined,
    defaults: { phase: RunCheckpoint['phase']; attemptCount?: number; nextAction?: string; activeHypothesisId?: string },
  ): RunCheckpoint {
    const timestamp = now();
    const fallback = this.createCheckpoint(defaults.phase, defaults.nextAction);
    return {
      ...fallback,
      ...(checkpoint || {}),
      phase: checkpoint?.phase || defaults.phase,
      activeHypothesisId: checkpoint?.activeHypothesisId || defaults.activeHypothesisId,
      completedActions: checkpoint?.completedActions || fallback.completedActions,
      knownFacts: checkpoint?.knownFacts || fallback.knownFacts,
      attemptCount: checkpoint?.attemptCount ?? defaults.attemptCount ?? fallback.attemptCount,
      nextAction: checkpoint?.nextAction ?? defaults.nextAction,
      lastProgressAt: checkpoint?.lastProgressAt || timestamp,
      stagnationCount: checkpoint?.stagnationCount ?? 0,
      replayCount: checkpoint?.replayCount ?? 0,
    };
  }

  private restoreTaskRun(
    taskRun: Partial<TaskRunSummary> | null | undefined,
    fallbackTodos?: TaskTodoItem[],
  ): TaskRunSummary | null {
    if (!taskRun?.id || !taskRun.goal) return null;
    const createdAt = taskRun.createdAt || now();
    const attemptCount = taskRun.attemptCount || taskRun.checkpoint?.attemptCount || 0;
    const phase = taskRun.phase || taskRun.checkpoint?.phase || 'act';
    const checkpoint = this.normalizeCheckpoint(taskRun.checkpoint, {
      phase,
      attemptCount,
      nextAction: taskRun.checkpoint?.nextAction,
      activeHypothesisId: taskRun.activeHypothesisId,
    });
    return {
      id: taskRun.id,
      goal: taskRun.goal,
      mode: taskRun.mode || (taskRun.source ? 'project' : 'generic'),
      status: taskRun.status || 'paused',
      phase,
      source: taskRun.source,
      repoAnalysis: taskRun.repoAnalysis,
      hypotheses: taskRun.hypotheses || [],
      activeHypothesisId: taskRun.activeHypothesisId || checkpoint.activeHypothesisId,
      attemptCount,
      failureHistory: taskRun.failureHistory || [],
      checkpoint,
      finalUrl: taskRun.finalUrl,
      currentAction: taskRun.currentAction,
      blockingReason: taskRun.blockingReason,
      autoRetryCount: taskRun.autoRetryCount || 0,
      nextAutoRetryAt: taskRun.nextAutoRetryAt,
      lastProgressAt: taskRun.lastProgressAt || checkpoint.lastProgressAt,
      checkpointReplayCount: taskRun.checkpointReplayCount ?? checkpoint.replayCount ?? 0,
      watchdogState: taskRun.watchdogState || 'healthy',
      watchdogAlerts: taskRun.watchdogAlerts || 0,
      selfCheckCount: taskRun.selfCheckCount || 0,
      lastSelfCheckAt: taskRun.lastSelfCheckAt,
      strategyHistory: taskRun.strategyHistory || [],
      longRangePlan: taskRun.longRangePlan || [],
      taskTodos: taskRun.taskTodos || fallbackTodos || this.createDefaultTodos(),
      childRuns: taskRun.childRuns || [],
      createdAt,
      updatedAt: taskRun.updatedAt || createdAt,
    };
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
    const transcriptTaskSnapshot = await this.transcriptStore.loadLatestTaskSnapshot(sessionId);
    const restoredTaskRun = restored?.activeTaskRun;
    const preferredTaskRun = transcriptTaskSnapshot
      && (!restoredTaskRun || (transcriptTaskSnapshot.updatedAt || 0) >= (restoredTaskRun.updatedAt || 0))
      ? transcriptTaskSnapshot
      : restoredTaskRun;
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
      activeRunId: restored?.activeRunId || preferredTaskRun?.id,
      activeTaskRun: this.restoreTaskRun(
        preferredTaskRun,
        restored?.taskTodos || [],
      ),
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
    const resumingGoal = isContinueIntent(options.goal)
      || (isOptionSelection(options.goal) && Boolean(session.activeTaskRun) && session.activeTaskRun?.status !== 'completed');
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
    session.remoteContext = await probeRemoteContext(
      this.sshMgr,
      session.connectionId,
      remoteHost,
      () => {
        if (session.webContents.isDestroyed()) return;
        session.webContents.send('terminal-data', {
          id: session.connectionId,
          data: `\r\n\x1b[33m[Agent] SSH connection dropped. Auto-reconnected while refreshing the remote context...\x1b[0m\r\n`,
        });
      },
    ).catch(() => ({
      host: remoteHost,
      user: 'unknown',
      pwd: '~',
      os: 'unknown',
      node: 'unknown',
      docker: 'unknown',
    }));

    this.captureKnownProjectPaths(session, effectiveGoal);
    await this.refreshMemory(session, this.pickLikelyProjectPath(session.knownProjectPaths));
    this.seedFollowUpMemory(session, effectiveGoal);
    this.historyPush(session, { role: 'user', content: options.goal });
    if (resumingGoal && session.activeTaskRun) {
      this.replayCheckpoint(session, {
        trigger: isContinueIntent(options.goal) || isOptionSelection(options.goal) ? 'resume' : 'restore',
        reason: session.activeTaskRun.status === 'retryable_paused'
          ? 'Resume after preserved retry pause'
          : 'Resume the preserved task from the last checkpoint',
      });
    }
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
    const checkpoint = this.createCheckpoint('understand');
    return {
      id: buildTaskRunId(),
      goal,
      mode: 'project',
      status: 'running',
      phase: 'understand',
      source: {
        type: /^https?:\/\/github\.com\//i.test(sourceLabel) ? 'github' : 'local',
        label: sourceLabel,
      },
      hypotheses: [],
      attemptCount: 0,
      failureHistory: [],
      checkpoint,
      autoRetryCount: 0,
      lastProgressAt: checkpoint.lastProgressAt,
      checkpointReplayCount: 0,
      watchdogState: 'healthy',
      watchdogAlerts: 0,
      selfCheckCount: 0,
      lastSelfCheckAt: undefined,
      strategyHistory: [],
      longRangePlan: [],
      taskTodos,
      childRuns: [],
      currentAction: /^https?:\/\/github\.com\//i.test(sourceLabel)
        ? "Analyzing GitHub repository on the remote server"
        : "Analyzing local project files and entry points",
      createdAt,
      updatedAt: createdAt,
    };
  }

  createGenericTaskRun(
    goal: string,
    options?: {
      mode?: 'generic' | 'site-followup';
      sourceLabel?: string;
      currentAction?: string;
      nextAction?: string;
    },
  ): TaskRunSummary {
    const createdAt = now();
    const taskTodos = this.createDefaultTodos();
    const checkpoint = this.createCheckpoint('act', options?.nextAction);
    return {
      id: buildTaskRunId(),
      goal,
      mode: options?.mode || 'generic',
      status: 'running',
      phase: 'act',
      source: options?.sourceLabel
        ? {
            type: /^https?:\/\/github\.com\//i.test(options.sourceLabel) ? 'github' : 'local',
            label: options.sourceLabel,
          }
        : undefined,
      hypotheses: [],
      attemptCount: 0,
      failureHistory: [],
      checkpoint,
      autoRetryCount: 0,
      lastProgressAt: checkpoint.lastProgressAt,
      checkpointReplayCount: 0,
      watchdogState: 'healthy',
      watchdogAlerts: 0,
      selfCheckCount: 0,
      lastSelfCheckAt: undefined,
      strategyHistory: [],
      longRangePlan: [],
      taskTodos,
      childRuns: [],
      currentAction: options?.currentAction || 'Working on the current task',
      createdAt,
      updatedAt: createdAt,
    };
  }

  recordProgress(
    session: AgentThreadSession,
    input: {
      note: string;
      signature?: string;
      force?: boolean;
      toolName?: string;
      toolStatus?: 'success' | 'failure';
    },
  ) {
    const run = session.activeTaskRun;
    if (!run) {
      return {
        progressed: false,
        stagnationCount: 0,
        stallAgeMs: 0,
      };
    }

    const checkpoint = this.normalizeCheckpoint(run.checkpoint, {
      phase: run.phase,
      attemptCount: run.attemptCount,
      nextAction: run.checkpoint.nextAction,
      activeHypothesisId: run.activeHypothesisId,
    });
    const note = input.note.trim();
    const signature = (input.signature || note || checkpoint.nextAction || '').trim().toLowerCase().slice(0, 400);
    const sameSignature = Boolean(signature) && signature === checkpoint.progressSignature;
    const progressed = input.force || (!sameSignature && Boolean(signature || note));
    const progressTimestamp = progressed ? now() : checkpoint.lastProgressAt;
    const stagnationCount = progressed ? 0 : checkpoint.stagnationCount + 1;

    run.checkpoint = {
      ...checkpoint,
      lastProgressNote: note || checkpoint.lastProgressNote,
      progressSignature: signature || checkpoint.progressSignature,
      lastProgressAt: progressTimestamp,
      stagnationCount,
      lastToolName: input.toolName ?? checkpoint.lastToolName,
      lastToolStatus: input.toolStatus ?? checkpoint.lastToolStatus,
      lastToolAt: input.toolName ? now() : checkpoint.lastToolAt,
    };
    run.lastProgressAt = progressTimestamp;
    run.watchdogState = stagnationCount >= WATCHDOG_STAGNATION_LIMIT ? 'stalled' : 'healthy';

    return {
      progressed,
      stagnationCount,
      stallAgeMs: Math.max(0, now() - progressTimestamp),
    };
  }

  getWatchdogSnapshot(session: AgentThreadSession) {
    const run = session.activeTaskRun;
    if (!run) {
      return {
        stalled: false,
        stagnationCount: 0,
        stallAgeMs: 0,
        shouldEscalate: false,
      };
    }
    const lastProgressAt = run.checkpoint.lastProgressAt || run.lastProgressAt || run.updatedAt;
    const stallAgeMs = Math.max(0, now() - lastProgressAt);
    const stagnationCount = run.checkpoint.stagnationCount || 0;
    const stalled = stagnationCount >= WATCHDOG_STAGNATION_LIMIT || stallAgeMs >= WATCHDOG_STALL_MS;
    return {
      stalled,
      stagnationCount,
      stallAgeMs,
      shouldEscalate: stalled && (run.watchdogAlerts || 0) < 6,
    };
  }

  replayCheckpoint(
    session: AgentThreadSession,
    input: {
      trigger: 'resume' | 'watchdog' | 'restore';
      reason: string;
      emitMessage?: boolean;
      addHistory?: boolean;
    },
  ) {
    const run = session.activeTaskRun;
    if (!run) return null;

    const route = run.activeHypothesisId
      ? run.hypotheses.find((item) => item.id === run.activeHypothesisId)?.kind || run.activeHypothesisId
      : undefined;
    const lastFailure = run.failureHistory[run.failureHistory.length - 1];
    const knownFacts = run.checkpoint.knownFacts.slice(-4);
    const summary = [
      `Checkpoint replay triggered by ${input.trigger}: ${input.reason}`,
      `Run goal: ${run.goal}`,
      `Phase/status: ${run.phase}/${run.status}`,
      route ? `Route: ${route}` : '',
      run.checkpoint.lastProgressNote ? `Last confirmed progress: ${clip(run.checkpoint.lastProgressNote, 320)}` : '',
      run.checkpoint.nextAction ? `Next action: ${clip(run.checkpoint.nextAction, 320)}` : '',
      lastFailure ? `Recent failure: ${lastFailure.failureClass}: ${clip(lastFailure.message, 320)}` : '',
      knownFacts.length ? `Known facts:\n${knownFacts.map((item) => `- ${clip(item, 220)}`).join('\n')}` : '',
      input.trigger === 'watchdog'
        ? 'Recovery instruction: do not repeat the same failing or stagnant step unchanged. Re-inspect the environment and choose a different strategy.'
        : '',
    ].filter(Boolean).join('\n');

    run.checkpoint = {
      ...run.checkpoint,
      replayCount: (run.checkpoint.replayCount || 0) + 1,
      lastReplayAt: now(),
      lastReplayReason: input.reason,
      lastProgressAt: now(),
      lastProgressNote: run.checkpoint.lastProgressNote || run.currentAction || run.goal,
      progressSignature: `replay:${input.trigger}:${clip(input.reason, 120)}`,
      stagnationCount: 0,
    };
    run.lastProgressAt = run.checkpoint.lastProgressAt;
    run.checkpointReplayCount = (run.checkpointReplayCount || 0) + 1;
    run.watchdogState = input.trigger === 'watchdog' ? 'recovering' : 'healthy';
    if (input.trigger === 'watchdog') {
      run.watchdogAlerts = (run.watchdogAlerts || 0) + 1;
    }

    session.planState.scratchpad = appendScratchpad(
      session.planState.scratchpad,
      `Checkpoint replay (${input.trigger}): ${input.reason}`,
    );
    session.planState.scratchpad = appendScratchpad(
      session.planState.scratchpad,
      run.checkpoint.nextAction ? `Replay next action: ${run.checkpoint.nextAction}` : `Replay current action: ${run.currentAction || run.goal}`,
    );

    if (input.addHistory !== false) {
      this.historyPush(session, { role: 'assistant', content: summary });
    }

    if (input.emitMessage !== false) {
      this.events.emitAssistantMessage(session, {
        id: `checkpoint-replay-${Date.now()}`,
        role: 'assistant',
        content: input.trigger === 'watchdog'
          ? 'Watchdog detected stalled progress. I restored the latest checkpoint and will force a different strategy.'
          : 'Recovered the latest checkpoint and will continue from the preserved task state.',
        timestamp: now(),
      });
    }

    return summary;
  }

  attachTaskRun(session: AgentThreadSession, taskRun: TaskRunSummary) {
    session.activeTaskRun = taskRun;
    session.activeRunId = taskRun.id;
    session.taskTodos = taskRun.taskTodos;
    this.recordProgress(session, {
      note: taskRun.currentAction || taskRun.goal,
      signature: `attach:${taskRun.mode}:${taskRun.phase}:${taskRun.currentAction || taskRun.goal}`,
      force: true,
    });
    this.syncPlanFromTaskRun(session);
    void this.transcriptStore.appendTaskSnapshot(session.id, taskRun);
    this.events.emitPlanUpdate(session, phaseToPlanStatus(taskRun));
  }

  upsertTaskRun(
    session: AgentThreadSession,
    patch: Partial<TaskRunSummary>,
    checkpointPatch?: Partial<RunCheckpoint>,
    options?: {
      suppressProgressLog?: boolean;
      trackProgress?: boolean;
      progressNote?: string;
      progressSignature?: string;
      progressForce?: boolean;
      toolName?: string;
      toolStatus?: 'success' | 'failure';
    },
  ) {
    if (!session.activeTaskRun) return;
    const checkpoint = this.normalizeCheckpoint(
      {
        ...session.activeTaskRun.checkpoint,
        ...(checkpointPatch || {}),
      },
      {
        phase: checkpointPatch?.phase || patch.phase || session.activeTaskRun.phase,
        attemptCount: checkpointPatch?.attemptCount ?? patch.attemptCount ?? session.activeTaskRun.attemptCount,
        nextAction: checkpointPatch?.nextAction ?? patch.checkpoint?.nextAction ?? session.activeTaskRun.checkpoint.nextAction,
        activeHypothesisId: checkpointPatch?.activeHypothesisId || patch.activeHypothesisId || session.activeTaskRun.activeHypothesisId,
      },
    );
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
    const isHeartbeatAction = typeof patch.currentAction === 'string' && /\belapsed\b/i.test(patch.currentAction);
    if (options?.trackProgress !== false) {
      const progressNote = options?.progressNote
        || (!isHeartbeatAction ? patch.currentAction : undefined)
        || checkpointPatch?.nextAction
        || patch.goal;
      if (progressNote?.trim()) {
        this.recordProgress(session, {
          note: progressNote,
          signature: options?.progressSignature,
          force: options?.progressForce,
          toolName: options?.toolName,
          toolStatus: options?.toolStatus,
        });
      }
    }
    session.activeRunId = session.activeTaskRun.id;
    this.syncPlanFromTaskRun(session);
    void this.transcriptStore.appendTaskSnapshot(session.id, session.activeTaskRun);
    if (patch.currentAction && !options?.suppressProgressLog && !isHeartbeatAction) {
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

  recordStrategyDecision(
    session: AgentThreadSession,
    input: {
      action: StrategyDecisionAction;
      summary: string;
      reason: string;
      routeId?: string;
      targetRouteId?: string;
      countAsSelfCheck?: boolean;
      currentAction?: string;
      nextAction?: string;
    },
  ) {
    const run = session.activeTaskRun;
    if (!run) return null;

    const timestamp = now();
    const entry: StrategyDecision = {
      id: `strategy-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
      action: input.action,
      summary: clip(input.summary.trim(), 240),
      reason: clip(input.reason.trim(), 600),
      routeId: input.routeId,
      targetRouteId: input.targetRouteId,
      timestamp,
    };
    const nextHistory = [...(run.strategyHistory || []), entry].slice(-12);
    const nextSelfCheckCount = (run.selfCheckCount || 0) + (input.countAsSelfCheck ? 1 : 0);

    this.upsertTaskRun(session, {
      strategyHistory: nextHistory,
      selfCheckCount: nextSelfCheckCount,
      lastSelfCheckAt: input.countAsSelfCheck ? timestamp : run.lastSelfCheckAt,
      currentAction: input.currentAction || run.currentAction,
    }, {
      nextAction: input.nextAction ?? run.checkpoint.nextAction,
    }, {
      trackProgress: false,
    });

    session.planState.scratchpad = appendScratchpad(
      session.planState.scratchpad,
      `Strategy ${input.action}: ${entry.summary} | ${entry.reason}`,
    );
    return entry;
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
      blocked: 4,
      complete: 5,
      failed: 5,
      paused: 4,
    };
    const currentRank = phaseRank[run.phase];
    run.longRangePlan = this.buildLongRangePlan(run);
    run.taskTodos = this.reconcileTaskTodos(run);
    session.taskTodos = run.taskTodos;

    session.planState.global_goal = run.goal;
    session.planState.plan = steps.map((item) => {
      let status: AgentThreadSession['planState']['plan'][number]['status'] = 'pending';
      if (item.id < currentRank) status = 'completed';
      if (item.id === currentRank) {
        status = run.status === 'failed'
          ? 'failed'
          : run.status === 'paused' || run.status === 'retryable_paused' || run.status === 'blocked'
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
    const retainedScratchpad = (session.planState.scratchpad || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const knownFacts = run.checkpoint.knownFacts
      .slice(-12)
      .map((fact) => fact.trim())
      .filter(Boolean);
    session.planState.scratchpad = Array.from(new Set([
      ...retainedScratchpad,
      ...knownFacts,
    ])).slice(-20).join('\n');
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
    }, {
      progressNote: summary,
      progressSignature: `tool:${toolName}:${result.ok ? 'ok' : 'failed'}:${clip(result.content, 200)}`,
      progressForce: result.ok,
      toolName,
      toolStatus: result.ok ? 'success' : 'failure',
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
    if (/429|serveroverloaded|toomanyrequests|request timed out after \d+s|llm api request failed: request timed out|anthropic api request failed: request timed out/.test(message)) {
      return 'llm_overloaded';
    }
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

  blockedText(reason: string) {
    const detail = clip(reason.trim(), 500);
    return `Task is blocked: ${detail}. Reply with the missing information and I will continue from the current state.`;
  }

  detectBlocker(content?: string, fallback?: string) {
    const combined = `${content || ''}\n${fallback || ''}`.trim();
    if (!combined) return null;

    const askUserMatch = combined.match(/(?:__ASK_USER__|ASK_USER)\s*:?\s*(.+)/i);
    if (askUserMatch?.[1]?.trim()) {
      return askUserMatch[1].trim();
    }

    if (/sudo:.*password is required|sudo:.*a terminal is required|permission denied \(publickey\)|authentication failed|invalid api key|invalid token|token expired/i.test(combined)) {
      return 'Access is blocked by credentials or authentication. A valid password, key, token, or permission change is required.';
    }

    if (/(api key|token|secret|password|passphrase|private key|credential|credentials|auth code|verification code)/i.test(combined)
      && /(missing|required|need|provide|enter|expired|invalid|not set|not configured|unavailable)/i.test(combined)) {
      return 'A required secret or credential is missing. Provide the needed key, token, password, or secret value to continue.';
    }

    if (/(domain|dns|callback url|webhook url|license key|备案)/i.test(combined)
      && /(missing|required|need|provide|confirm|which|what)/i.test(combined)) {
      return 'A required deployment detail is missing. Provide the exact domain, callback URL, license key, or other requested value to continue.';
    }

    return null;
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
    const followUpSource = this.inferFollowUpSource(session, goal);
    if (followUpSource) {
      if (!session.knownProjectPaths.includes(followUpSource)) {
        session.knownProjectPaths.push(followUpSource);
      }
      return followUpSource;
    }

    const directMatch = extractDeploySource(goal, session.knownProjectPaths);
    if (directMatch) return directMatch;

    const contextualMatch = this.inferContextualProjectSource(session, goal);
    if (contextualMatch) {
      if (!session.knownProjectPaths.includes(contextualMatch)) {
        session.knownProjectPaths.push(contextualMatch);
      }
      return contextualMatch;
    }

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
      .filter((item) => !/^\d+$/.test(item))
      .filter((item) => !stopWords.has(item.toLowerCase()))
      .sort((a, b) => b.length - a.length);
  }

  private async findDirectoryMatch(root: string, candidates: string[], exact: boolean) {
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    let bestMatch: { path: string; score: number } | null = null;
    let scannedDirs = 0;

    while (queue.length > 0 && scannedDirs < 240) {
      const current = queue.shift()!;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      scannedDirs += 1;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(current.dir, entry.name);
        const score = this.scoreDirectoryMatch(root, fullPath, candidates, exact);
        if (score > 0 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { path: fullPath, score };
        }
        if (current.depth < 2 && !entry.name.startsWith('.')) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
      }
    }

    return bestMatch?.path || null;
  }

  private scoreDirectoryMatch(root: string, fullPath: string, candidates: string[], exact: boolean) {
    const relativePath = path.relative(root, fullPath);
    if (!relativePath) return 0;

    const segments = relativePath
      .split(path.sep)
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean);
    if (!segments.length) return 0;

    const basename = segments[segments.length - 1];
    let score = 0;
    let matched = 0;

    candidates.forEach((candidate, index) => {
      const normalizedCandidate = candidate.toLowerCase();
      const segmentMatched = segments.some((segment) => (
        exact
          ? segment === normalizedCandidate
          : segment === normalizedCandidate
            || segment.includes(normalizedCandidate)
            || normalizedCandidate.includes(segment)
      ));
      if (!segmentMatched) return;

      matched += 1;
      score += 120 - Math.min(index, 10) * 8;
      if (basename === normalizedCandidate) {
        score += 80;
      } else if (!exact && (basename.includes(normalizedCandidate) || normalizedCandidate.includes(basename))) {
        score += 30;
      }
    });

    if (!matched) return 0;
    return score + segments.length * 12 + matched * 35;
  }

  private inferFollowUpSource(session: AgentThreadSession, goal: string) {
    if (!looksLikeSiteFollowUpGoal(goal)) return null;

    const run = session.activeTaskRun;
    if (!run?.source?.label) return null;

    const looksSuccessful = Boolean(run.finalUrl) || run.status === 'completed';
    if (!looksSuccessful) return null;

    const mentionedUrls = this.extractUrls(goal);
    if (mentionedUrls.length > 0) {
      if (!run.finalUrl) return null;
      try {
        const finalHost = new URL(run.finalUrl).host;
        const mentionedHosts = mentionedUrls.map((item) => {
          try {
            return new URL(item).host;
          } catch {
            return '';
          }
        }).filter(Boolean);
        if (!mentionedHosts.includes(finalHost)) {
          return null;
        }
      } catch {
        return null;
      }
    } else if (now() - run.updatedAt > 30 * 60 * 1000) {
      return null;
    }

    return run.source.label;
  }

  private inferContextualProjectSource(session: AgentThreadSession, goal: string) {
    if (!session.knownProjectPaths.length) return null;

    const aliasMatched = session.knownProjectPaths.find((candidate) => {
      const aliases = this.projectSourceAliases(candidate);
      return aliases.some((alias) => alias && goal.toLowerCase().includes(alias.toLowerCase()));
    });
    if (aliasMatched) {
      return aliasMatched;
    }

    const hasProjectPronoun =
      /\b(?:it|this|that|current|previous)\b/i.test(goal)
      || /\u5b83|\u8fd9\u4e2a|\u90a3\u4e2a|\u5f53\u524d|\u4e0a\u4e00\u4e2a|\u521a\u624d\u90a3\u4e2a/.test(goal);
    if ((looksLikeDeploymentGoal(goal) || looksLikeProjectScopedGoal(goal)) && hasProjectPronoun) {
      return session.knownProjectPaths[session.knownProjectPaths.length - 1] || null;
    }

    return null;
  }

  private projectSourceAliases(candidate: string) {
    const aliases = new Set<string>();
    const normalized = candidate.trim();
    if (!normalized) return [];

    if (/^https?:\/\//i.test(normalized)) {
      try {
        const parsed = new URL(normalized);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const repo = parts[1]?.replace(/\.git$/i, '');
        if (parts[0]) aliases.add(parts[0]);
        if (repo) aliases.add(repo);
      } catch {
        // Ignore URL parsing failures and fall back to raw basename logic below.
      }
    }

    const basename = path.basename(normalized).trim();
    if (basename) aliases.add(basename);
    const parentName = path.basename(path.dirname(normalized)).trim();
    if (parentName && parentName !== '.' && parentName !== basename) aliases.add(parentName);

    return Array.from(aliases)
      .map((item) => item.toLowerCase())
      .filter(Boolean)
      .filter((item) => item.length >= 2);
  }

  private seedFollowUpMemory(session: AgentThreadSession, goal: string) {
    if (!looksLikeSiteFollowUpGoal(goal)) return;
    const run = session.activeTaskRun;
    if (!run?.source?.label) return;
    if (!(run.finalUrl || run.status === 'completed')) return;

    const route = run.activeHypothesisId
      ? run.hypotheses.find((item) => item.id === run.activeHypothesisId)?.kind
      : undefined;
    const handoff = [
      `Follow-up site context: ${run.source.label}`,
      run.finalUrl ? `Last deployed URL: ${run.finalUrl}` : '',
      route ? `Last successful route: ${route}` : '',
      'Treat domain, HTTPS, Certbot, or SSL renewal requests as operations on this deployed site unless the user names a different project.',
    ].filter(Boolean).join('\n');

    session.compressedMemory = clip(
      session.compressedMemory ? `${session.compressedMemory}\n\n${handoff}` : handoff,
      6000,
    );
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

  private buildLongRangePlan(run: TaskRunSummary) {
    const route = run.activeHypothesisId
      ? run.hypotheses.find((item) => item.id === run.activeHypothesisId)
      : run.hypotheses[0];
    const fallbackRoutes = run.hypotheses
      .filter((item) => item.id !== route?.id)
      .slice(0, 2)
      .map((item) => item.kind);
    const framework = run.repoAnalysis?.framework || 'unknown';
    const steps = [
      run.source?.label
        ? `Lock the source root and inspect deployable assets from ${run.source.label}`
        : 'Confirm the exact source root before changing the server',
      `Inspect repository/runtime signals for ${framework} and compare them with the remote server capabilities`,
      route
        ? `Primary route: ${route.kind}. Fallbacks: ${fallbackRoutes.length ? fallbackRoutes.join(', ') : 're-inspect source and environment'}`
        : 'Choose a primary deployment route and keep at least one fallback route ready',
      this.describeExecutionMilestone(run, route),
      run.repoAnalysis?.healthCheckCandidates?.length
        ? `Verify the deployed result with ${run.repoAnalysis.healthCheckCandidates.slice(0, 2).join(' / ')} and capture the final reachable URL`
        : 'Probe the public site or service port until there is a confirmed reachable result',
      'If verification fails, summarize what changed, what failed, and switch strategy instead of repeating the same step unchanged',
    ];
    return Array.from(new Set(steps.filter(Boolean))).slice(0, 6);
  }

  private describeExecutionMilestone(run: TaskRunSummary, route?: RouteHypothesis) {
    const framework = run.repoAnalysis?.framework || 'application';
    switch (route?.kind) {
      case 'static-nginx':
        return 'Prepare the frontend runtime, build static assets, pack the dist/build output into one release archive, upload and extract it remotely, then wire nginx to the public endpoint';
      case 'node-runtime':
        return 'Prepare one release archive, upload and extract it remotely, install Node dependencies, build if needed, boot the service with a supervisor, and connect nginx or the public port';
      case 'python-runtime':
        return 'Prepare one release archive, upload and extract it remotely, install Python dependencies, create the runtime environment, boot the service, and expose it through nginx or the public port';
      case 'java-runtime':
        return 'Build the Java artifact or package one release archive, upload and extract it remotely, run it under systemd, and connect nginx or the public port';
      case 'compose-native':
        return 'Use the repository compose stack, validate service health, and expose the correct public entrypoint';
      case 'dockerfile-native':
        return 'Build the repository Docker image, run the container correctly, and verify the exposed entrypoint';
      default:
        return `Execute the best deployment path for the ${framework} project, then verify and repair until it is reachable`;
    }
  }

  private reconcileTaskTodos(run: TaskRunSummary): TaskTodoItem[] {
    const route = run.activeHypothesisId
      ? run.hypotheses.find((item) => item.id === run.activeHypothesisId)
      : run.hypotheses[0];
    const routeSummary = route
      ? `${route.kind}${run.hypotheses.length > 1 ? ` with fallback ${run.hypotheses.filter((item) => item.id !== route.id).slice(0, 1).map((item) => item.kind).join(', ')}` : ''}`
      : 'the primary route with a fallback if needed';
    const existing: TaskTodoItem[] = [
      {
        id: 'understand',
        content: run.source?.label
          ? `Lock the task goal and source root: ${run.source.label}`
          : 'Lock the task goal and identify the source root',
        status: 'pending',
      },
      {
        id: 'inspect',
        content: run.repoAnalysis
          ? `Inspect repo/server facts for ${run.repoAnalysis.framework}/${run.repoAnalysis.language} and confirm missing capabilities`
          : 'Inspect repository structure, runtime requirements, and remote server facts',
        status: 'pending',
      },
      {
        id: 'hypothesize',
        content: `Choose ${routeSummary} based on the collected evidence`,
        status: 'pending',
      },
      {
        id: 'act',
        content: this.describeExecutionMilestone(run, route),
        status: 'pending',
      },
      {
        id: 'verify',
        content: run.longRangePlan?.[4] || 'Verify the externally reachable result and record the final URL',
        status: 'pending',
      },
    ];
    const rankByPhase: Record<TaskRunSummary['phase'], number> = {
      understand: 0,
      inspect: 1,
      hypothesize: 2,
      act: 3,
      repair: 3,
      blocked: 3,
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
