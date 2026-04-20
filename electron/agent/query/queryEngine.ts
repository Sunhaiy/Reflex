import path from 'path';
import { Dirent, promises as fs } from 'fs';
import {
  callLLMWithTools,
  LLMRequestError,
  LLMToolCall,
} from '../../llm.js';
import type { FailureClass } from '../../../src/shared/deployTypes.js';
import type { PlanState } from '../../../src/shared/aiTypes.js';
import type { RouteHypothesis, TaskRunFailure } from '../../../src/shared/types.js';
import { appendScratchpad, buildSystemPrompt, makeArtifactPreview } from '../prompts.js';
import { HypothesisPlanner } from '../hypothesisPlanner.js';
import { buildRepoAnalysis, summarizeKnownFacts } from '../repoAnalysis.js';
import { AgentRepoInspector } from '../repoInspector.js';
import type { AgentThreadSession } from '../types.js';
import type { AgentToolDefinition } from '../types.js';
import { AgentEventBus } from '../runtime/eventBus.js';
import { AgentAutoCompactService } from '../services/compact/autoCompact.js';
import {
  MAX_AUTONOMOUS_REPAIRS,
  MAX_CONSECUTIVE_TOOL_FAILURES,
  MAX_GENERIC_TURNS,
  MAX_LLM_RETRY_ATTEMPTS,
  MAX_ROUTE_TURNS,
  clip,
  formatElapsed,
  GITHUB_PROJECT_URL_RE,
  LOCAL_PROJECT_PATH_RE,
  makeArtifact,
  now,
  phaseToPlanStatus,
  looksLikeSiteFollowUpGoal,
  looksLikeDeploymentGoal,
  safeParseArgs,
  serializeValue,
  toolCallSummary,
} from '../runtime/helpers.js';
import { AgentSessionStore } from '../state/sessionStore.js';

export interface RouteExecutionResult {
  ok: boolean;
  finalUrl?: string;
  failureClass?: FailureClass;
  failureMessage?: string;
  attemptCount: number;
}

export interface AgentTaskRunOptions {
  resumeRequested: boolean;
  repoInspector: AgentRepoInspector;
  hypothesisPlanner: HypothesisPlanner;
}

const READ_ONLY_TOOLS = new Set([
  'local_list_directory',
  'local_read_file',
  'remote_list_directory',
  'remote_read_file',
  'http_probe',
  'service_inspect',
  'todo_read',
]);

export class AgentQueryEngine {
  constructor(
    private toolRegistry: AgentToolDefinition,
    private store: AgentSessionStore,
    private events: AgentEventBus,
    private compactService: AgentAutoCompactService,
  ) {}

  async runTask(
    session: AgentThreadSession,
    goal: string,
    options: AgentTaskRunOptions,
  ): Promise<boolean> {
    const activeRunMode = session.activeTaskRun?.mode;
    const siteFollowUpGoal = looksLikeSiteFollowUpGoal(goal);
    const deploymentGoal = looksLikeDeploymentGoal(goal);
    const continuingRun =
      options.resumeRequested &&
      Boolean(session.activeTaskRun) &&
      session.activeTaskRun?.status !== 'completed';

    if (continuingRun && activeRunMode && activeRunMode !== 'project') {
      return this.runGenericTask(session, goal, {
        continuingRun: true,
        sourceLabel: session.activeTaskRun?.source?.label,
        mode: activeRunMode,
      });
    }

    const resolvedSource = await this.store.resolveDeploySource(session, goal);
    const sourceLabel = continuingRun
      ? this.pickProjectSourceForResume(session, resolvedSource)
      : resolvedSource;

    GITHUB_PROJECT_URL_RE.lastIndex = 0;
    LOCAL_PROJECT_PATH_RE.lastIndex = 0;
    const explicitProjectSourceInGoal =
      GITHUB_PROJECT_URL_RE.test(goal) || LOCAL_PROJECT_PATH_RE.test(goal);

    if (siteFollowUpGoal && !explicitProjectSourceInGoal && !continuingRun) {
      return this.runSiteFollowUpTask(session, goal, sourceLabel || undefined);
    }

    if (sourceLabel && (deploymentGoal || continuingRun)) {
      return this.runAutonomousProjectTask(session, goal, sourceLabel, continuingRun, options);
    }

    return this.runGenericTask(session, goal, sourceLabel ? { sourceLabel } : undefined);
  }

  async runGenericTask(
    session: AgentThreadSession,
    goal: string,
    options?: {
      continuingRun?: boolean;
      sourceLabel?: string;
      mode?: 'generic' | 'site-followup';
    },
  ): Promise<boolean> {
    session.planState.global_goal = goal;
    session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, `Goal: ${goal}`);
    this.events.emitPlanUpdate(session, 'generating');

    const continuingRun = Boolean(options?.continuingRun && session.activeTaskRun);
    if (!continuingRun) {
      const run = this.store.createGenericTaskRun(goal, {
        mode: options?.mode || 'generic',
        sourceLabel: options?.sourceLabel,
        currentAction: options?.mode === 'site-followup'
          ? 'Inspecting the current site, nginx, and certificate state'
          : 'Understanding the goal and deciding the next action',
        nextAction: 'Inspect the current state and continue execution',
      });
      this.store.attachTaskRun(session, run);
      session.recentHttpProbes = [];
      session.lastToolFailure = undefined;
    } else if (session.activeTaskRun) {
      this.store.upsertTaskRun(session, {
        status: 'running',
        phase: 'act',
        blockingReason: undefined,
        nextAutoRetryAt: undefined,
        autoRetryCount: 0,
        watchdogState: 'healthy',
        currentAction: options?.mode === 'site-followup'
          ? 'Resuming the site follow-up task'
          : 'Resuming the current task',
      }, {
        phase: 'act',
        nextAction: 'Continue from the preserved task state',
      });
    }

    let completed = false;
    try {
      while (!session.aborted && session.turnCounter < MAX_GENERIC_TURNS) {
        session.turnCounter += 1;
        await this.compactService.maybeCompact(session);
        if (session.activeTaskRun) {
          this.store.upsertTaskRun(session, {
            status: 'running',
            phase: 'act',
            currentAction: options?.mode === 'site-followup'
              ? 'Inspecting and updating the current site configuration'
              : 'Thinking, inspecting facts, and deciding the next action',
          }, {
            phase: 'act',
            nextAction: 'Continue the current task loop',
          });
        }
        this.events.emitPlanUpdate(session, 'executing');

        const response = await this.callLLMWithRetries(session);
        this.store.updateContextWindow(session, response.usage);
        const text = response.content?.trim() || '';

        if (text) {
          this.events.emitAssistantMessage(session, {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: text,
            timestamp: now(),
            usage: response.usage,
            modelUsed: response.modelUsed,
          });
        }

        if (!response.toolCalls?.length) {
          const blockerReason = this.store.detectBlocker(text, session.lastToolFailure?.message);
          if (blockerReason) {
            this.markBlocked(session, blockerReason, {
              messageContent: text || undefined,
              emitMessage: !text,
            });
            return true;
          }
          if (text) {
            this.store.historyPush(session, { role: 'assistant', content: text });
          }
          if (session.activeTaskRun) {
            const verifiedUrl = this.store.detectVerifiedUrl(session, text);
            this.store.upsertTaskRun(session, {
              status: 'completed',
              phase: 'complete',
              finalUrl: verifiedUrl,
              blockingReason: undefined,
              nextAutoRetryAt: undefined,
              autoRetryCount: 0,
              currentAction: 'The task finished and produced a final answer.',
            }, {
              phase: 'complete',
              nextAction: undefined,
            });
          }
          completed = true;
          return true;
        }

        this.store.historyPush(session, {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls,
        });
        const results = await this.executeToolCalls(session, response.toolCalls);
        if (session.activeTaskRun?.status === 'blocked') {
          return true;
        }
        const watchdogHandled = this.maybeHandleGenericWatchdog(session);
        if (watchdogHandled) {
          continue;
        }
        if (results.some((result) => !result.ok) && session.consecutiveFailures >= MAX_CONSECUTIVE_TOOL_FAILURES) {
          continue;
        }
      }

      if (session.activeTaskRun?.status === 'blocked') {
        return true;
      }
      if (session.aborted) {
        return false;
      }

      const limitMessage = 'The current task reached the autonomous turn budget. Context is preserved, and you can ask me to continue.';
      if (session.activeTaskRun) {
        this.store.upsertTaskRun(session, {
          status: 'paused',
          phase: 'paused',
          currentAction: limitMessage,
        }, {
          phase: 'paused',
          nextAction: 'Send continue to resume the same task',
        });
      }
      this.store.historyPush(session, { role: 'assistant', content: limitMessage });
      this.events.emitAssistantMessage(session, {
        id: `limit-${Date.now()}`,
        role: 'assistant',
        content: limitMessage,
        timestamp: now(),
        isError: true,
      });
      return true;
    } catch (error: any) {
      if (session.aborted) {
        return false;
      }
      const blockerReason = this.blockerReasonFromError(error);
      if (blockerReason) {
        this.markBlocked(session, blockerReason);
        return true;
      }
      const failureClass = this.store.classifyAutonomousFailure(undefined, error?.message || String(error));
      const failure: TaskRunFailure = {
        attempt: Math.max((session.activeTaskRun?.attemptCount || 0) + 1, 1),
        routeId: session.activeTaskRun?.activeHypothesisId,
        failureClass,
        message: error?.message || String(error),
        timestamp: now(),
      };
      if (session.activeTaskRun) {
        const pausedAction = 'The AI service is temporarily busy. Preserving state and waiting for automatic retry.';
        this.store.upsertTaskRun(session, {
          status: failureClass === 'llm_overloaded' ? 'retryable_paused' : 'failed',
          phase: failureClass === 'llm_overloaded' ? 'paused' : 'failed',
          blockingReason: undefined,
          nextAutoRetryAt: undefined,
          attemptCount: failure.attempt,
          failureHistory: [...(session.activeTaskRun.failureHistory || []), failure].slice(-20),
          currentAction: failureClass === 'llm_overloaded' ? pausedAction : this.store.failureText(failure, true),
        }, {
          phase: failureClass === 'llm_overloaded' ? 'paused' : 'failed',
          attemptCount: failure.attempt,
          nextAction: failureClass === 'llm_overloaded'
            ? 'Waiting for automatic retry; you can also send continue immediately'
            : undefined,
        });
      }
      const failureText = failureClass === 'llm_overloaded'
        ? 'The AI service is temporarily busy. I preserved the current task state and will retry automatically.'
        : this.store.failureText(failure, true);
      this.store.historyPush(session, { role: 'assistant', content: failureText });
      this.events.emitAssistantMessage(session, {
        id: `generic-task-error-${Date.now()}`,
        role: 'assistant',
        content: failureText,
        timestamp: now(),
        isError: true,
      });
      return true;
    } finally {
      this.events.emitPlanUpdate(
        session,
        session.activeTaskRun
          ? phaseToPlanStatus(session.activeTaskRun)
          : session.aborted
            ? 'stopped'
            : completed
              ? 'done'
              : 'stopped',
      );
    }
  }

  async runSiteFollowUpTask(
    session: AgentThreadSession,
    goal: string,
    inheritedSource?: string,
  ): Promise<boolean> {
    const inheritedSiteLabel = session.activeTaskRun?.finalUrl || inheritedSource;
    session.planState.global_goal = goal;
    session.planState.scratchpad = appendScratchpad(
      session.planState.scratchpad,
      inheritedSiteLabel
        ? `Site follow-up for ${inheritedSiteLabel}`
        : `Site follow-up task: ${goal}`,
    );
    this.events.emitAssistantMessage(session, {
      id: `site-followup-${Date.now()}`,
      role: 'assistant',
      content: inheritedSiteLabel
        ? `I will treat this as a follow-up operation on the previously deployed site (${inheritedSiteLabel}) and continue with domain, HTTPS, and SSL handling directly on the server.`
        : 'I will treat this as an existing-site operation and inspect the current server, nginx, and certificate state before applying domain and HTTPS changes.',
      timestamp: now(),
    });
    return this.runGenericTask(session, goal, {
      mode: 'site-followup',
      sourceLabel: inheritedSource,
    });
  }

  async executeRoute(session: AgentThreadSession, route: RouteHypothesis): Promise<RouteExecutionResult> {
    const maxRouteTurns = MAX_ROUTE_TURNS;
    let turns = 0;

    session.planState.scratchpad = appendScratchpad(
      session.planState.scratchpad,
      `Current route: ${route.kind} | Evidence: ${route.evidence.join(' | ') || route.summary}`,
    );

    while (!session.aborted && turns < maxRouteTurns) {
      turns += 1;
      session.turnCounter += 1;
      await this.compactService.maybeCompact(session);
      this.events.emitPlanUpdate(session, phaseToPlanStatus(session.activeTaskRun!));

      const response = await this.callLLMWithRetries(session);
      this.store.updateContextWindow(session, response.usage);

      const text = response.content?.trim() || '';
      if (text) {
        this.events.emitAssistantMessage(session, {
          id: `route-think-${Date.now()}-${turns}`,
          role: 'assistant',
          content: text,
          timestamp: now(),
          usage: response.usage,
          modelUsed: response.modelUsed,
        });
        this.store.recordProgress(session, {
          note: `Route ${route.kind} reasoning: ${clip(text, 240)}`,
          signature: `route-think:${route.kind}:${clip(text, 180)}`,
        });
      }

      if (!response.toolCalls?.length) {
        const blockerReason = this.store.detectBlocker(text, session.lastToolFailure?.message);
        if (blockerReason) {
          this.markBlocked(session, blockerReason, {
            messageContent: text || undefined,
            emitMessage: !text,
          });
          return {
            ok: false,
            failureClass: 'unknown',
            failureMessage: blockerReason,
            attemptCount: session.activeTaskRun?.attemptCount || 0,
          };
        }
        if (text) {
          this.store.historyPush(session, { role: 'assistant', content: text });
        }
        const verifiedUrl = this.store.detectVerifiedUrl(session, text);
        if (verifiedUrl) {
          return {
            ok: true,
            finalUrl: verifiedUrl,
            attemptCount: session.activeTaskRun?.attemptCount || 0,
          };
        }
        return {
          ok: false,
          failureClass: this.store.classifyAutonomousFailure(text, session.lastToolFailure?.message),
          failureMessage: text || session.lastToolFailure?.message || 'Route stopped before external verification',
          attemptCount: session.activeTaskRun?.attemptCount || 0,
        };
      }

      this.store.historyPush(session, {
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls,
      });

      const results = await this.executeToolCalls(session, response.toolCalls);
      if (session.activeTaskRun?.status === 'blocked') {
        return {
          ok: false,
          failureClass: 'unknown',
          failureMessage: session.activeTaskRun.blockingReason || session.activeTaskRun.currentAction || 'Task is blocked',
          attemptCount: session.activeTaskRun?.attemptCount || 0,
        };
      }
      const watchdogResult = this.maybeHandleRouteWatchdog(session, route);
      if (watchdogResult) {
        return watchdogResult;
      }
      for (const result of results) {
        if (!result.ok && session.consecutiveFailures >= MAX_CONSECUTIVE_TOOL_FAILURES) {
          return {
            ok: false,
            failureClass: this.store.classifyAutonomousFailure(result.content, result.content),
            failureMessage: result.content,
            attemptCount: session.activeTaskRun?.attemptCount || 0,
          };
        }
      }
    }

    if (session.activeTaskRun?.status === 'blocked') {
      return {
        ok: false,
        failureClass: 'unknown',
        failureMessage: session.activeTaskRun.blockingReason || session.activeTaskRun.currentAction || 'Task is blocked',
        attemptCount: session.activeTaskRun?.attemptCount || 0,
      };
    }
    if (session.aborted) {
      return {
        ok: false,
        failureClass: 'unknown',
        failureMessage: 'Route execution stopped before verification',
        attemptCount: session.activeTaskRun?.attemptCount || 0,
      };
    }

    const verifiedUrl = this.store.detectVerifiedUrl(session);
    if (verifiedUrl) {
      return {
        ok: true,
        finalUrl: verifiedUrl,
        attemptCount: session.activeTaskRun?.attemptCount || 0,
      };
    }

    return {
      ok: false,
      failureClass: this.store.classifyAutonomousFailure(undefined, session.lastToolFailure?.message),
      failureMessage: session.lastToolFailure?.message || `Route ${route.kind} reached the autonomous turn budget before verification`,
      attemptCount: session.activeTaskRun?.attemptCount || 0,
    };
  }

  private async runAutonomousProjectTask(
    session: AgentThreadSession,
    goal: string,
    sourceLabel: string,
    continuingRun: boolean,
    options: AgentTaskRunOptions,
  ): Promise<boolean> {
    await this.store.refreshMemory(
      session,
      /^https?:\/\/github\.com\//i.test(sourceLabel) ? undefined : sourceLabel,
    );

    if (!continuingRun) {
      const run = this.store.createTaskRun(goal, sourceLabel);
      this.store.attachTaskRun(session, run);
      session.recentHttpProbes = [];
      session.lastToolFailure = undefined;
      this.events.emitAssistantMessage(session, {
        id: `task-run-${Date.now()}`,
        role: 'assistant',
        content: 'Goal received. I will inspect the repository and server first, build route hypotheses, then execute, verify, and repair autonomously.',
        timestamp: now(),
      });
    } else {
      session.lastToolFailure = undefined;
      const sourceChanged = session.activeTaskRun?.source?.label && session.activeTaskRun.source.label !== sourceLabel;
      this.store.upsertTaskRun(session, {
        source: sourceChanged
          ? {
              type: /^https?:\/\/github\.com\//i.test(sourceLabel) ? 'github' : 'local',
              label: sourceLabel,
            }
          : session.activeTaskRun?.source,
        repoAnalysis: sourceChanged ? undefined : session.activeTaskRun?.repoAnalysis,
        hypotheses: sourceChanged ? [] : session.activeTaskRun?.hypotheses,
        activeHypothesisId: sourceChanged ? undefined : session.activeTaskRun?.activeHypothesisId,
        attemptCount: sourceChanged ? 0 : session.activeTaskRun?.attemptCount,
        blockingReason: undefined,
        nextAutoRetryAt: undefined,
        autoRetryCount: 0,
        watchdogState: 'healthy',
        status: 'running',
        phase: sourceChanged ? 'inspect' : session.activeTaskRun?.phase,
        currentAction: sourceChanged
          ? `Recovered a more specific project source and will re-inspect it: ${sourceLabel}`
          : session.activeTaskRun?.currentAction,
      });
      if (sourceChanged) {
        this.events.emitAssistantMessage(session, {
          id: `task-source-refined-${Date.now()}`,
          role: 'assistant',
          content: `I found a more specific project root for this task and will retry from there: ${sourceLabel}`,
          timestamp: now(),
        });
      }
    }

    this.store.syncPlanFromTaskRun(session);
    this.events.emitPlanUpdate(session, session.activeTaskRun ? 'executing' : 'idle');

    try {
      if (!continuingRun || !session.activeTaskRun?.repoAnalysis || !session.activeTaskRun?.hypotheses.length) {
        this.store.upsertTaskRun(session, {
          phase: 'inspect',
          status: 'running',
          currentAction: /^https?:\/\/github\.com\//i.test(sourceLabel)
            ? 'Inspecting the GitHub repository on the remote server: checkout, README, build files, and runtime/container signals'
            : 'Inspecting the local project: README, build entry, and runtime signals',
        }, {
          phase: 'inspect',
          nextAction: 'Analyze source code and server environment',
        });

        const stopInspectHeartbeat = this.startTaskHeartbeat(
          session,
          () => /^https?:\/\/github\.com\//i.test(sourceLabel)
            ? 'Still reading the repository structure, README, and build signals on the server'
            : 'Still inspecting the local project files and build entry',
        );
        const analysis = await options.repoInspector.analyze(session.connectionId, {
          projectRoot: sourceLabel,
          source: /^https?:\/\/github\.com\//i.test(sourceLabel)
            ? { type: 'github', url: sourceLabel }
            : { type: 'local', path: sourceLabel },
        }).finally(() => stopInspectHeartbeat());

        const repoAnalysis = buildRepoAnalysis(analysis);
        const hypotheses = options.hypothesisPlanner.build(analysis.projectSpec, analysis.serverSpec, repoAnalysis);
        const knownFacts = summarizeKnownFacts(analysis.projectSpec, analysis.serverSpec);

        this.store.upsertTaskRun(session, {
          repoAnalysis,
          hypotheses,
          phase: 'hypothesize',
          status: 'running',
          currentAction: hypotheses.length
            ? `Built ${hypotheses.length} route hypotheses. Trying ${hypotheses[0]?.kind} first.`
            : 'Route hypothesis generation finished.',
        }, {
          phase: 'hypothesize',
          knownFacts,
          completedActions: ['source-resolved', 'repo-analyzed', 'server-probed'],
          nextAction: hypotheses[0] ? `Try ${hypotheses[0].kind}` : undefined,
        }, {
          progressNote: hypotheses.length
            ? `Repository analysis completed. Candidate routes: ${hypotheses.map((item) => item.kind).join(', ')}`
            : 'Repository analysis completed but no route hypotheses were formed',
          progressSignature: `analysis:${repoAnalysis.framework}:${repoAnalysis.language}:${hypotheses.map((item) => item.kind).join('|')}`,
          progressForce: true,
        });
        this.store.recordStrategyDecision(session, {
          action: 'decompose',
          summary: 'Expanded the long-running deployment into explicit milestones',
          reason: hypotheses.length
            ? `Framework ${repoAnalysis.framework}/${repoAnalysis.language}; primary route ${hypotheses[0]?.kind}; fallbacks ${hypotheses.slice(1).map((item) => item.kind).join(', ') || 'none'}`
            : `Framework ${repoAnalysis.framework}/${repoAnalysis.language}; repository facts are still ambiguous`,
          nextAction: hypotheses[0] ? `Preflight-check ${hypotheses[0].kind}` : 'Recover a clearer source root or request an exact path',
        });
        this.store.recordStrategyDecision(session, {
          action: 'self_check',
          summary: hypotheses.length
            ? 'Validated repository and server assumptions before execution'
            : 'Validated repository and server assumptions but could not lock a route yet',
          reason: this.buildAnalysisSelfCheckReason(repoAnalysis, hypotheses),
          countAsSelfCheck: true,
          nextAction: hypotheses[0] ? `Preflight-check ${hypotheses[0].kind}` : 'Recover a clearer source root or request an exact path',
        });

        session.planState.scratchpad = `${session.planState.scratchpad}\nRepo analysis: ${repoAnalysis.framework}/${repoAnalysis.language} (${Math.round(repoAnalysis.confidence * 100)}%)`.trim();
        this.events.emitAssistantMessage(session, {
          id: `route-plan-${Date.now()}`,
          role: 'assistant',
          content: hypotheses.length
            ? `Built candidate routes: ${hypotheses.map((item) => item.kind).join(' -> ')}. Trying ${hypotheses[0]?.kind} first.`
            : 'Repository signals are still limited. I will continue by validating the most likely route first.',
          timestamp: now(),
        });

        if (!hypotheses.length) {
          const recoveredSource = await this.tryRecoverNestedProjectSource(sourceLabel);
          if (recoveredSource && recoveredSource !== sourceLabel) {
            if (!session.knownProjectPaths.includes(recoveredSource)) {
              session.knownProjectPaths.push(recoveredSource);
            }
            this.store.recordStrategyDecision(session, {
              action: 'reinspect_source',
              summary: 'The original source root looked like a container directory',
              reason: `Recovered nested project root ${recoveredSource} after the first analysis produced zero viable routes`,
              countAsSelfCheck: true,
              nextAction: 'Re-inspect the recovered nested project root and rebuild route hypotheses',
            });
            this.store.upsertTaskRun(session, {
              source: {
                type: 'local',
                label: recoveredSource,
              },
              repoAnalysis: undefined,
              hypotheses: [],
              activeHypothesisId: undefined,
              attemptCount: 0,
              status: 'repairing',
              phase: 'inspect',
              blockingReason: undefined,
              nextAutoRetryAt: undefined,
              autoRetryCount: 0,
              watchdogState: 'healthy',
              currentAction: `The original source looked like a container folder. Re-inspecting nested project root: ${recoveredSource}`,
            }, {
              phase: 'inspect',
              nextAction: 'Analyze the recovered nested project root and rebuild route hypotheses',
            }, {
              progressNote: `Recovered nested project root: ${recoveredSource}`,
              progressSignature: `source-recovery:${recoveredSource}`,
              progressForce: true,
            });
            this.events.emitAssistantMessage(session, {
              id: `task-source-recovered-${Date.now()}`,
              role: 'assistant',
              content: `The first path looked like a container directory, not the actual app root. I found a more likely nested project at ${recoveredSource} and will retry automatically.`,
              timestamp: now(),
            });
            return this.runAutonomousProjectTask(session, goal, recoveredSource, true, options);
          }

          const failure: TaskRunFailure = {
            attempt: 1,
            failureClass: 'unknown',
            message: 'No viable route hypotheses could be formed from the repository and server facts.',
            timestamp: now(),
          };
          this.store.recordStrategyDecision(session, {
            action: 'replan',
            summary: 'No viable route was confirmed after the first planning pass',
            reason: 'The repository facts are still too weak to choose a safe deployment path. Preserve state and wait for another recovery pass or a more specific source path.',
            countAsSelfCheck: true,
            nextAction: 'Retry with continue or provide the exact project root path',
          });
          this.store.upsertTaskRun(session, {
            status: 'paused',
            phase: 'paused',
            attemptCount: 1,
            failureHistory: [failure],
            currentAction: 'Project signals are still too ambiguous. State is preserved for another recovery pass or a more specific project path.',
          }, {
            phase: 'paused',
            nextAction: 'Retry with continue or provide the exact project root path',
          });
          this.events.emitAssistantMessage(session, {
            id: `task-no-route-${Date.now()}`,
            role: 'assistant',
            content: 'I still could not build a viable deployment route from the current repository facts. I preserved the state instead of discarding it. Reply with continue to let me retry, or send the exact project root path.',
            timestamp: now(),
            isError: true,
          });
          return true;
        }
      }

      const currentRun = session.activeTaskRun!;
      const startIndex = Math.max(
        0,
        currentRun.activeHypothesisId ? currentRun.hypotheses.findIndex((item) => item.id === currentRun.activeHypothesisId) : 0,
      );

      for (let index = startIndex; index < currentRun.hypotheses.length; index += 1) {
        const route = session.activeTaskRun?.hypotheses[index];
        if (!route) continue;
        this.store.upsertTaskRun(session, {
          phase: session.activeTaskRun!.attemptCount > 0 ? 'repair' : 'act',
          status: session.activeTaskRun!.attemptCount > 0 ? 'repairing' : 'running',
          activeHypothesisId: route.id,
          watchdogState: 'healthy',
          currentAction:
            session.activeTaskRun!.attemptCount > 0 && session.activeTaskRun?.activeHypothesisId === route.id
              ? `Repairing and continuing route ${route.kind}`
              : `Trying route ${route.kind}`,
        }, {
          phase: session.activeTaskRun!.attemptCount > 0 ? 'repair' : 'act',
          activeHypothesisId: route.id,
          nextAction: `Execute ${route.kind}`,
        }, {
          progressNote: `Route selection: ${route.kind}`,
          progressSignature: `route:${route.kind}:attempt:${session.activeTaskRun!.attemptCount}`,
          progressForce: true,
        });
        this.store.recordStrategyDecision(session, {
          action: 'self_check',
          summary: `Preflight-checking route ${route.kind}`,
          reason: this.buildRoutePreflightReason(session, route),
          routeId: route.id,
          countAsSelfCheck: true,
          nextAction: `Execute ${route.kind}, but switch quickly if verification disproves it`,
        });

        this.events.emitAssistantMessage(session, {
          id: `route-${Date.now()}-${index}`,
          role: 'assistant',
          content: `Current route: ${route.kind}. Evidence: ${(route.evidence.slice(0, 2).join('; ') || route.summary)}`,
          timestamp: now(),
        });

        const stopRouteHeartbeat = this.startTaskHeartbeat(
          session,
          () => `Still executing route ${route.kind}`,
        );
        const result = await this.executeRoute(session, route)
          .finally(() => stopRouteHeartbeat());

        if (result.ok) {
          this.store.upsertTaskRun(session, {
            status: 'completed',
            phase: 'complete',
            activeHypothesisId: route.id,
            finalUrl: result.finalUrl,
            blockingReason: undefined,
            nextAutoRetryAt: undefined,
            autoRetryCount: 0,
            currentAction: 'External verification passed. Task completed.',
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
          const successText = `Task completed. URL: ${result.finalUrl || session.sshHost}. Route: ${route.kind}.`;
          this.store.historyPush(session, { role: 'assistant', content: successText });
          this.events.emitAssistantMessage(session, {
            id: `task-success-${Date.now()}`,
            role: 'assistant',
            content: successText,
            timestamp: now(),
          });
          return true;
        }

        if (session.activeTaskRun?.status === 'blocked') {
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
        this.store.upsertTaskRun(session, {
          status: attempt >= MAX_AUTONOMOUS_REPAIRS ? 'failed' : 'repairing',
          phase: attempt >= MAX_AUTONOMOUS_REPAIRS ? 'failed' : 'repair',
          blockingReason: undefined,
          nextAutoRetryAt: undefined,
          attemptCount: attempt,
          failureHistory,
          watchdogState: 'healthy',
          currentAction: this.store.failureText(failure, false),
        }, {
          phase: attempt >= MAX_AUTONOMOUS_REPAIRS ? 'failed' : 'repair',
          attemptCount: attempt,
          activeHypothesisId: route.id,
          nextAction: attempt >= MAX_AUTONOMOUS_REPAIRS
            ? undefined
            : `Evaluate whether to continue ${route.kind} or switch to the next route`,
        }, {
          progressNote: `Route ${route.kind} failed with ${failure.failureClass}: ${failure.message}`,
          progressSignature: `route-failure:${route.kind}:${failure.failureClass}:${clip(failure.message, 200)}`,
        });

        if (attempt >= MAX_AUTONOMOUS_REPAIRS) {
          this.store.recordStrategyDecision(session, {
            action: 'replan',
            summary: `Repair budget exhausted for ${route.kind}`,
            reason: `The route failed ${attempt} time(s). Automatic repairs are exhausted, so the preserved state must wait for a manual continue or a different source/route hint.`,
            routeId: route.id,
            countAsSelfCheck: true,
          });
          const failureText = this.store.failureText(failure, true);
          this.store.historyPush(session, { role: 'assistant', content: failureText });
          this.events.emitAssistantMessage(session, {
            id: `task-exhausted-${Date.now()}`,
            role: 'assistant',
            content: failureText,
            timestamp: now(),
            isError: true,
          });
          return true;
        }

        const recovery = this.planRouteRecovery(session, route, failure, index);
        this.store.recordStrategyDecision(session, {
          action: recovery.action,
          summary: recovery.summary,
          reason: recovery.reason,
          routeId: route.id,
          targetRouteId: recovery.targetRouteId,
          countAsSelfCheck: true,
          nextAction: recovery.nextAction,
        });

        if (recovery.action === 'switch_route' && typeof recovery.nextIndex === 'number') {
          const targetRoute = session.activeTaskRun!.hypotheses[recovery.nextIndex];
          this.events.emitAssistantMessage(session, {
            id: `route-switch-${Date.now()}`,
            role: 'assistant',
            content: targetRoute
              ? `Route ${route.kind} hit a failing pattern (${failure.failureClass}). I will switch to ${targetRoute.kind} and continue.`
              : `Route ${route.kind} hit a failing pattern (${failure.failureClass}). I will switch to another candidate route and continue.`,
            timestamp: now(),
          });
          index = recovery.nextIndex - 1;
          continue;
        }

        if (recovery.action === 'replan') {
          this.store.upsertTaskRun(session, {
            repoAnalysis: undefined,
            hypotheses: [],
            activeHypothesisId: undefined,
            phase: 'inspect',
            status: 'repairing',
            currentAction: 'Repeated failures suggest the current assumptions are stale. Re-inspecting the source and server facts before choosing another strategy.',
          }, {
            phase: 'inspect',
            nextAction: 'Rebuild route hypotheses from refreshed source and server facts',
          }, {
            progressNote: `Forced strategy replan after repeated ${route.kind} failures`,
            progressSignature: `replan:${route.kind}:${failure.failureClass}`,
            progressForce: true,
          });
          this.events.emitAssistantMessage(session, {
            id: `route-replan-${Date.now()}`,
            role: 'assistant',
            content: `Route ${route.kind} keeps failing without converging. I will re-inspect the source and environment before choosing a different strategy.`,
            timestamp: now(),
          });
          return this.runAutonomousProjectTask(session, goal, sourceLabel, true, options);
        }

        this.events.emitAssistantMessage(session, {
          id: `route-repair-${Date.now()}`,
          role: 'assistant',
          content: `Route ${route.kind} still has repair space. I finished a self-check and will continue autonomous repair round ${attempt + 1}/5 with a changed tactic.`,
          timestamp: now(),
        });
        index -= 1;
      }

      const lastFailure = session.activeTaskRun?.failureHistory[session.activeTaskRun.failureHistory.length - 1];
      const finalFailureText = this.store.failureText(lastFailure, true);
      this.store.upsertTaskRun(session, {
        status: 'failed',
        phase: 'failed',
        currentAction: finalFailureText,
      }, {
        phase: 'failed',
        nextAction: undefined,
      });
      this.events.emitAssistantMessage(session, {
        id: `task-failed-${Date.now()}`,
        role: 'assistant',
        content: finalFailureText,
        timestamp: now(),
        isError: true,
      });
      return true;
    } catch (error: any) {
      if (session.aborted) {
        return false;
      }
      const blockerReason = this.blockerReasonFromError(error);
      if (blockerReason) {
        this.markBlocked(session, blockerReason);
        return true;
      }
      const failureClass: FailureClass = /429|ServerOverloaded|TooManyRequests/i.test(error?.message || '')
        ? 'llm_overloaded'
        : 'unknown';
      const failure: TaskRunFailure = {
        attempt: Math.max((session.activeTaskRun?.attemptCount || 0) + 1, 1),
        routeId: session.activeTaskRun?.activeHypothesisId,
        failureClass,
        message: error?.message || String(error),
        timestamp: now(),
      };
      const paused = failure.failureClass === 'llm_overloaded';
      const failureHistory = [...(session.activeTaskRun?.failureHistory || []), failure].slice(-20);
      const pausedAction = 'The AI service is temporarily busy. Preserving state and waiting for automatic retry.';
      this.store.upsertTaskRun(session, {
        status: paused ? 'retryable_paused' : 'failed',
        phase: paused ? 'paused' : 'failed',
        blockingReason: undefined,
        nextAutoRetryAt: undefined,
        attemptCount: Math.max(session.activeTaskRun?.attemptCount || 0, failure.attempt),
        failureHistory,
        currentAction: paused ? pausedAction : this.store.failureText(failure, true),
      }, {
        phase: paused ? 'paused' : 'failed',
        attemptCount: Math.max(session.activeTaskRun?.attemptCount || 0, failure.attempt),
        nextAction: paused ? 'Waiting for automatic retry; you can also send continue immediately' : undefined,
      });
      const failureText = paused
        ? 'The AI service is temporarily busy. I preserved the current task state and will retry automatically.'
        : this.store.failureText(failure, true);
      this.events.emitAssistantMessage(session, {
        id: `task-run-error-${Date.now()}`,
        role: 'assistant',
        content: failureText,
        timestamp: now(),
        isError: true,
      });
      return true;
    } finally {
      session.resumeRequested = false;
    }
  }

  private makeBlockedError(reason: string) {
    const error = new Error(reason) as Error & { blockerReason?: string };
    error.name = 'AgentBlockedError';
    error.blockerReason = reason;
    return error;
  }

  private blockerReasonFromError(error: any) {
    if (typeof error?.blockerReason === 'string' && error.blockerReason.trim()) {
      return error.blockerReason.trim();
    }
    return this.store.detectBlocker(error?.message || String(error));
  }

  private buildAnalysisSelfCheckReason(
    repoAnalysis: { framework: string; language: string; packaging: string; confidence: number; runtimeRequirements: Array<{ name: string; version?: string }>; deploymentHints: string[] },
    hypotheses: RouteHypothesis[],
  ) {
    const runtimeSummary = repoAnalysis.runtimeRequirements.length
      ? repoAnalysis.runtimeRequirements.map((item) => `${item.name}${item.version ? `(${item.version})` : ''}`).join(', ')
      : 'no explicit runtime requirements';
    const hintSummary = repoAnalysis.deploymentHints.slice(0, 2).join('; ') || 'no deployment hints';
    const routeSummary = hypotheses.length
      ? hypotheses.map((item) => `${item.kind}(${item.score.toFixed(2)})`).join(', ')
      : 'no viable routes yet';
    return `Framework ${repoAnalysis.framework}/${repoAnalysis.language}, packaging ${repoAnalysis.packaging}, confidence ${Math.round(repoAnalysis.confidence * 100)}%, runtimes ${runtimeSummary}, hints ${hintSummary}, candidate routes ${routeSummary}.`;
  }

  private buildRoutePreflightReason(session: AgentThreadSession, route: RouteHypothesis) {
    const run = session.activeTaskRun;
    const evidence = route.evidence.slice(0, 3).join('; ') || route.summary;
    const capabilities = route.requiredCapabilities.join(', ') || 'no explicit capabilities';
    const buildCommand = run?.repoAnalysis?.buildCommands?.[0];
    const outputDir = run?.repoAnalysis?.outputDir;
    const sourceType = run?.source?.type || run?.repoAnalysis?.sourceType;
    const executionHint = sourceType === 'local'
      ? route.kind === 'static-nginx'
        ? `Use a local build plus one archived release upload. Prefer local_exec -> local_pack_archive -> remote_upload_file -> remote_extract_archive before nginx verification.`
        : `Prefer one archived release upload and remote extraction instead of many single-file uploads.`
      : `Prefer remote checkout/build steps because the source is remote.`;
    return `Evidence: ${evidence}. Required capabilities: ${capabilities}. ${buildCommand ? `Build command: ${buildCommand}. ` : ''}${outputDir ? `Output directory: ${outputDir}. ` : ''}${executionHint} Disproof signals: ${route.disproofSignals.slice(0, 2).join('; ') || 'none recorded yet'}.`;
  }

  private planRouteRecovery(
    session: AgentThreadSession,
    route: RouteHypothesis,
    failure: TaskRunFailure,
    currentIndex: number,
  ): {
    action: 'switch_route' | 'retry_route' | 'replan';
    summary: string;
    reason: string;
    nextAction?: string;
    nextIndex?: number;
    targetRouteId?: string;
  } {
    const run = session.activeTaskRun!;
    const sameRouteFailures = run.failureHistory.filter((item) => item.routeId === route.id);
    const sameFailureClassCount = sameRouteFailures.filter((item) => item.failureClass === failure.failureClass).length;
    const alternativeIndex = this.pickAlternativeRouteIndex(run, currentIndex, route.id);
    const shouldSwitch =
      typeof alternativeIndex === 'number' && (
        this.store.shouldSwitchRoute(route, failure.failureClass as FailureClass)
        || sameRouteFailures.length >= 2
        || sameFailureClassCount >= 2
        || (run.watchdogAlerts || 0) > 0
      );

    if (shouldSwitch) {
      const targetRoute = run.hypotheses[alternativeIndex];
      return {
        action: 'switch_route',
        summary: `Switch away from ${route.kind} after repeated or disproving failures`,
        reason: `Failure ${failure.failureClass}: ${clip(failure.message, 220)}. ${sameRouteFailures.length} failure(s) already accumulated on ${route.kind}, so move to ${targetRoute?.kind || 'the next fallback route'}.`,
        nextAction: targetRoute ? `Execute fallback route ${targetRoute.kind}` : 'Execute the next fallback route',
        nextIndex: alternativeIndex,
        targetRouteId: targetRoute?.id,
      };
    }

    const canReplan =
      alternativeIndex == null
      && (sameRouteFailures.length >= 2 || sameFailureClassCount >= 2 || failure.failureClass === 'unknown')
      && (run.selfCheckCount || 0) < 6;
    if (canReplan) {
      return {
        action: 'replan',
        summary: `Current route ${route.kind} no longer looks trustworthy`,
        reason: `Failure ${failure.failureClass}: ${clip(failure.message, 220)}. No healthy fallback route remains, so refresh repository/server facts and rebuild the strategy from scratch.`,
        nextAction: 'Re-inspect the source and server facts before picking another route',
      };
    }

    return {
      action: 'retry_route',
      summary: `Retry ${route.kind} with a changed repair tactic`,
      reason: `Failure ${failure.failureClass}: ${clip(failure.message, 220)}. The route still has repair headroom and no stronger fallback signal yet.`,
      nextAction: `Repair ${route.kind} with a different tactic instead of repeating the exact same step`,
    };
  }

  private pickAlternativeRouteIndex(
    run: NonNullable<AgentThreadSession['activeTaskRun']>,
    currentIndex: number,
    currentRouteId: string,
  ) {
    const alternatives = run.hypotheses
      .map((item, index) => {
        const failureCount = run.failureHistory.filter((failure) => failure.routeId === item.id).length;
        return { item, index, failureCount };
      })
      .filter(({ item, index }) => item.id !== currentRouteId && index !== currentIndex);
    if (!alternatives.length) return null;

    alternatives.sort((a, b) => a.failureCount - b.failureCount || b.item.score - a.item.score || a.index - b.index);
    return alternatives[0]?.index ?? null;
  }

  private pickProjectSourceForResume(session: AgentThreadSession, resolvedSource: string | null) {
    const currentSource = session.activeTaskRun?.source?.label || null;
    if (!currentSource) return resolvedSource;
    if (!resolvedSource) return currentSource;

    const currentRun = session.activeTaskRun;
    const shouldRefreshSource =
      currentRun?.status === 'failed'
      || currentRun?.status === 'paused'
      || !currentRun?.hypotheses?.length
      || currentRun?.repoAnalysis?.framework === 'unknown'
      || (resolvedSource !== currentSource && this.isMoreSpecificLocalPath(currentSource, resolvedSource));

    return shouldRefreshSource ? resolvedSource : currentSource;
  }

  private isMoreSpecificLocalPath(currentSource: string, nextSource: string) {
    if (/^https?:\/\//i.test(currentSource) || /^https?:\/\//i.test(nextSource)) return false;
    const currentNormalized = path.resolve(currentSource);
    const nextNormalized = path.resolve(nextSource);
    return nextNormalized.startsWith(`${currentNormalized}${path.sep}`);
  }

  private async tryRecoverNestedProjectSource(sourceLabel: string): Promise<string | null> {
    if (!sourceLabel || /^https?:\/\//i.test(sourceLabel)) return null;

    const root = path.resolve(sourceLabel);
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    let bestCandidate: { path: string; score: number } | null = null;
    let scannedDirs = 0;

    while (queue.length > 0 && scannedDirs < 200) {
      const current = queue.shift()!;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      scannedDirs += 1;

      const names = new Set(entries.map((entry) => entry.name));
      if (current.dir !== root) {
        const score = this.scoreNestedProjectRoot(names, current.depth);
        if (score > 0 && (!bestCandidate || score > bestCandidate.score)) {
          bestCandidate = { path: current.dir, score };
        }
      }

      if (current.depth >= 2) continue;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
        queue.push({
          dir: path.join(current.dir, entry.name),
          depth: current.depth + 1,
        });
      }
    }

    return bestCandidate?.path || null;
  }

  private scoreNestedProjectRoot(names: Set<string>, depth: number) {
    let score = 0;
    if (names.has('package.json')) score += 140;
    if (Array.from(names).some((name) => /^vite\.config\./i.test(name))) score += 90;
    if (names.has('Dockerfile')) score += 110;
    if (names.has('docker-compose.yml') || names.has('compose.yml')) score += 120;
    if (names.has('requirements.txt') || names.has('pyproject.toml')) score += 110;
    if (names.has('pom.xml') || names.has('build.gradle') || names.has('build.gradle.kts')) score += 110;
    if (names.has('src')) score += 35;
    if (names.has('app')) score += 24;
    if (names.has('public')) score += 18;
    if (names.has('README.md') || names.has('README')) score += 15;
    if (names.has('dist') || names.has('build')) score += 12;
    if (depth === 1) score += 10;
    return score;
  }

  private markBlocked(
    session: AgentThreadSession,
    reason: string,
    options?: {
      messageContent?: string;
      emitMessage?: boolean;
    },
  ) {
    const content = options?.messageContent?.trim() || this.store.blockedText(reason);
    if (session.activeTaskRun) {
      this.store.upsertTaskRun(session, {
        status: 'blocked',
        phase: 'blocked',
        blockingReason: reason,
        nextAutoRetryAt: undefined,
        currentAction: content,
      }, {
        phase: 'blocked',
        nextAction: 'Wait for the user to provide the missing information, credential, or decision',
      });
    }
    this.store.historyPush(session, { role: 'assistant', content });
    if (options?.emitMessage !== false) {
      this.events.emitAssistantMessage(session, {
        id: `task-blocked-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: now(),
        isError: true,
      });
    }
  }

  private async callLLMWithRetries(session: AgentThreadSession) {
    const maxAttempts = MAX_LLM_RETRY_ATTEMPTS;
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
          : /(429|ServerOverloaded|TooManyRequests|temporarily overloaded)/i.test(error?.message || '');
        if (retryable && attempt >= maxAttempts) {
          const message = error?.message || String(error);
          throw new Error(`${message} Retried ${attempt}/${maxAttempts} times.`);
        }
        if (!retryable || session.aborted) {
          throw error;
        }
        const waitMs = Math.min(20000, 1500 * (2 ** (attempt - 1)));
        session.planState.scratchpad = appendScratchpad(
          session.planState.scratchpad,
          `AI service busy, retry ${attempt}/${maxAttempts} after ${waitMs}ms`,
        );
        await this.sleep(waitMs, session.abortController?.signal);
      }
    }
    throw new Error('AI service retry failed');
  }

  private buildConversation(session: AgentThreadSession) {
    const artifactSummaries = Array.from(session.artifacts.values())
      .slice(-4)
      .map((artifact) => ({
        role: 'system' as const,
        content: `Artifact memory:\n${artifact.id}\n${artifact.title}\n${clip(makeArtifactPreview(artifact.preview), 800)}`,
      }));

    return [
      { role: 'system' as const, content: buildSystemPrompt(session) },
      ...artifactSummaries,
      ...session.history.slice(-18),
    ];
  }

  private async executeToolCalls(session: AgentThreadSession, toolCalls: LLMToolCall[]) {
    if (!toolCalls.length) return [];
    const allReadOnly = toolCalls.every((toolCall) => READ_ONLY_TOOLS.has(toolCall.function.name));
    if (allReadOnly) {
      return Promise.all(toolCalls.map((toolCall) => this.executeToolCall(session, toolCall)));
    }
    const results = [];
    for (const toolCall of toolCalls) {
      if (session.aborted) break;
      results.push(await this.executeToolCall(session, toolCall));
    }
    return results;
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
    this.events.emitPlanUpdate(session, 'executing');
    if (session.activeTaskRun) {
      const nextPhase = this.store.inferTaskPhaseFromTool(toolCall.function.name);
      this.store.upsertTaskRun(session, {
        currentAction: description,
        phase: nextPhase,
        status: session.activeTaskRun.status === 'repairing' ? 'repairing' : 'running',
      }, {
        phase: nextPhase,
        nextAction: description,
      }, {
        progressNote: description,
        progressSignature: `tool-start:${toolCall.function.name}:${description}`,
        toolName: toolCall.function.name,
      });
    }

    this.events.emitAssistantMessage(session, {
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
      session.consecutiveFailures = result.ok ? 0 : session.consecutiveFailures + 1;
      session.lastToolFailure = result.ok
        ? undefined
        : {
            name: toolCall.function.name,
            message: result.content,
            timestamp: now(),
          };
      planStep.status = result.ok ? 'completed' : 'failed';
      planStep.command = result.displayCommand;
      planStep.result = result.ok ? clip(result.content, 240) : undefined;
      planStep.error = result.ok ? undefined : clip(result.content, 240);
      session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, result.scratchpadNote);
      this.store.rememberToolOutcome(session, toolCall.function.name, result);

      const serialized = serializeValue(result.structured);
      const toolContent = serialized.length > 1600 ? this.storeArtifact(session, toolCall.function.name, serialized) : serialized;
      this.store.historyPush(session, {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolContent,
      });
      this.events.emitToolResultMessage(session, toolCall.function.name, result.displayCommand, result.content, result.ok);
      const blockerReason = !result.ok ? this.store.detectBlocker(result.content) : null;
      if (blockerReason) {
        session.planState.scratchpad = appendScratchpad(
          session.planState.scratchpad,
          `Blocked on missing input or credentials: ${blockerReason}`,
        );
        throw this.makeBlockedError(blockerReason);
      }
      finalResult = {
        ok: result.ok,
        content: result.content,
      };
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      const blockerReason = this.blockerReasonFromError(error);
      if (blockerReason && error?.name === 'AgentBlockedError') {
        throw error;
      }
      if (!blockerReason) {
        session.consecutiveFailures += 1;
      }
      session.lastToolFailure = {
        name: toolCall.function.name,
        message: errorMessage,
        timestamp: now(),
      };
      planStep.status = 'failed';
      planStep.command = description;
      planStep.error = clip(errorMessage, 240);
      session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, `Failure: ${description} -> ${errorMessage}`);
      this.store.historyPush(session, {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ ok: false, error: errorMessage }),
      });
      this.events.emitToolResultMessage(session, toolCall.function.name, description, errorMessage, false);

      const runtimeBlockerReason = blockerReason || this.store.detectBlocker(errorMessage);
      if (runtimeBlockerReason) {
        session.planState.scratchpad = appendScratchpad(
          session.planState.scratchpad,
          `Blocked on missing input or credentials: ${runtimeBlockerReason}`,
        );
        throw this.makeBlockedError(runtimeBlockerReason);
      }

      if (session.consecutiveFailures === MAX_CONSECUTIVE_TOOL_FAILURES) {
        const recoveryHint = [
          `Multiple tool calls failed in a row (${session.consecutiveFailures}).`,
          'Stop repeating the same failing action unchanged.',
          'Re-inspect the environment, switch route, or choose a different repair strategy.',
        ].join(' ');
        session.planState.scratchpad = appendScratchpad(
          session.planState.scratchpad,
          recoveryHint,
        );
        this.store.historyPush(session, { role: 'assistant', content: recoveryHint });
        if (session.activeTaskRun) {
          this.store.upsertTaskRun(session, {
            currentAction: recoveryHint,
          }, {
            nextAction: 'Choose a different recovery action instead of retrying the same failing step',
          });
        }
      }
      finalResult = {
        ok: false,
        content: errorMessage,
      };
    }

    this.events.emitPlanUpdate(session, 'executing');
    return finalResult;
  }

  private maybeHandleGenericWatchdog(session: AgentThreadSession) {
    const snapshot = this.store.getWatchdogSnapshot(session);
    if (!snapshot.shouldEscalate || !session.activeTaskRun) return false;

    const reason = `No meaningful progress for ${formatElapsed(snapshot.stallAgeMs)} with ${snapshot.stagnationCount} repeated step(s)`;
    this.store.replayCheckpoint(session, {
      trigger: 'watchdog',
      reason,
    });
    this.store.upsertTaskRun(session, {
      watchdogState: 'recovering',
      currentAction: 'Watchdog triggered. Re-inspecting the environment and forcing a different strategy.',
    }, {
      nextAction: 'Inspect fresh facts and choose a different strategy than the stalled one',
    }, {
      trackProgress: false,
    });
    return true;
  }

  private maybeHandleRouteWatchdog(session: AgentThreadSession, route: RouteHypothesis): RouteExecutionResult | null {
    const snapshot = this.store.getWatchdogSnapshot(session);
    if (!snapshot.shouldEscalate || !session.activeTaskRun) return null;

    const reason = `Route ${route.kind} made no meaningful progress for ${formatElapsed(snapshot.stallAgeMs)} with ${snapshot.stagnationCount} repeated step(s)`;
    this.store.replayCheckpoint(session, {
      trigger: 'watchdog',
      reason,
    });
    this.store.upsertTaskRun(session, {
      watchdogState: 'recovering',
      currentAction: `Watchdog triggered on route ${route.kind}. Replaying the checkpoint and switching strategy.`,
    }, {
      nextAction: `Switch away from ${route.kind} or choose a different repair action from the replayed checkpoint`,
    }, {
      trackProgress: false,
    });
    return {
      ok: false,
      failureClass: 'unknown',
      failureMessage: `Watchdog reroute: ${reason}`,
      attemptCount: session.activeTaskRun.attemptCount,
    };
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

  private startTaskHeartbeat(
    session: AgentThreadSession,
    describe: () => string,
    intervalMs = 15000,
  ) {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (session.aborted || !session.running || !session.activeTaskRun) return;
      const elapsed = formatElapsed(Date.now() - startedAt);
      this.store.upsertTaskRun(session, {
        currentAction: `${describe()} · elapsed ${elapsed}`,
      });
    }, intervalMs);
    return () => clearInterval(timer);
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
}
