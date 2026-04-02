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
  MAX_GENERIC_TURNS,
  clip,
  formatElapsed,
  makeArtifact,
  now,
  phaseToPlanStatus,
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
    const continuingRun =
      options.resumeRequested &&
      Boolean(session.activeTaskRun) &&
      !['completed', 'failed'].includes(session.activeTaskRun?.status || '');

    const sourceLabel = continuingRun
      ? session.activeTaskRun?.source?.label || await this.store.resolveDeploySource(session, goal)
      : await this.store.resolveDeploySource(session, goal);

    if (sourceLabel) {
      return this.runAutonomousProjectTask(session, goal, sourceLabel, continuingRun, options);
    }

    return this.runGenericTask(session, goal);
  }

  async runGenericTask(session: AgentThreadSession, goal: string): Promise<boolean> {
    session.planState.global_goal = goal;
    session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, `Goal: ${goal}`);
    this.events.emitPlanUpdate(session, 'generating');

    let completed = false;
    try {
      while (!session.aborted && session.turnCounter < MAX_GENERIC_TURNS) {
        session.turnCounter += 1;
        await this.compactService.maybeCompact(session);
        this.events.emitPlanUpdate(session, 'executing');

        const response = await this.callLLMWithRetries(session);
        this.store.updateContextWindow(session, response.usage);

        if (response.content?.trim()) {
          const text = response.content.trim();
          this.events.emitAssistantMessage(session, {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: text,
            timestamp: now(),
            usage: response.usage,
            modelUsed: response.modelUsed,
          });
          if (!response.toolCalls?.length) {
            this.store.historyPush(session, { role: 'assistant', content: text });
          }
        }

        if (!response.toolCalls?.length) {
          completed = true;
          return true;
        }

        this.store.historyPush(session, {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls,
        });

        await this.executeToolCalls(session, response.toolCalls);
      }

      const limitMessage = 'The current task reached the autonomous turn budget. Context is preserved, and you can ask me to continue.';
      this.store.historyPush(session, { role: 'assistant', content: limitMessage });
      this.events.emitAssistantMessage(session, {
        id: `limit-${Date.now()}`,
        role: 'assistant',
        content: limitMessage,
        timestamp: now(),
        isError: true,
      });
      return true;
    } finally {
      this.events.emitPlanUpdate(session, session.aborted ? 'stopped' : completed ? 'done' : 'stopped');
    }
  }

  async executeRoute(session: AgentThreadSession, route: RouteHypothesis): Promise<RouteExecutionResult> {
    const maxRouteTurns = 12;
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
      }

      if (!response.toolCalls?.length) {
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
      for (const result of results) {
        if (!result.ok && session.consecutiveFailures >= 4) {
          return {
            ok: false,
            failureClass: this.store.classifyAutonomousFailure(result.content, result.content),
            failureMessage: result.content,
            attemptCount: session.activeTaskRun?.attemptCount || 0,
          };
        }
      }
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
      this.events.emitAssistantMessage(session, {
        id: `task-resume-${Date.now()}`,
        role: 'assistant',
        content: 'Resuming the current task. I will continue from the confirmed facts, active route, and failure history.',
        timestamp: now(),
      });
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
          const failure: TaskRunFailure = {
            attempt: 1,
            failureClass: 'unknown',
            message: 'No viable route hypotheses could be formed from the repository and server facts.',
            timestamp: now(),
          };
          this.store.upsertTaskRun(session, {
            status: 'failed',
            phase: 'failed',
            attemptCount: 1,
            failureHistory: [failure],
            currentAction: this.store.failureText(failure, true),
          }, {
            phase: 'failed',
          });
          this.events.emitAssistantMessage(session, {
            id: `task-no-route-${Date.now()}`,
            role: 'assistant',
            content: this.store.failureText(failure, true),
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
          currentAction:
            session.activeTaskRun!.attemptCount > 0 && session.activeTaskRun?.activeHypothesisId === route.id
              ? `Repairing and continuing route ${route.kind}`
              : `Trying route ${route.kind}`,
        }, {
          phase: session.activeTaskRun!.attemptCount > 0 ? 'repair' : 'act',
          activeHypothesisId: route.id,
          nextAction: `Execute ${route.kind}`,
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
          attemptCount: attempt,
          failureHistory,
          currentAction: this.store.failureText(failure, false),
        }, {
          phase: attempt >= MAX_AUTONOMOUS_REPAIRS ? 'failed' : 'repair',
          attemptCount: attempt,
          activeHypothesisId: route.id,
          nextAction: attempt >= MAX_AUTONOMOUS_REPAIRS
            ? undefined
            : `Evaluate whether to continue ${route.kind} or switch to the next route`,
        });

        if (attempt >= MAX_AUTONOMOUS_REPAIRS) {
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

        const shouldSwitch = index < session.activeTaskRun!.hypotheses.length - 1
          && this.store.shouldSwitchRoute(route, result.failureClass);
        if (shouldSwitch) {
          this.events.emitAssistantMessage(session, {
            id: `route-switch-${Date.now()}`,
            role: 'assistant',
            content: `Route ${route.kind} could not prove success yet. I will switch to the next candidate route and continue.`,
            timestamp: now(),
          });
          continue;
        }

        this.events.emitAssistantMessage(session, {
          id: `route-repair-${Date.now()}`,
          role: 'assistant',
          content: `Route ${route.kind} still has repair space. I will continue autonomous repair round ${attempt + 1}/5.`,
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
      this.store.upsertTaskRun(session, {
        status: paused ? 'retryable_paused' : 'failed',
        phase: paused ? 'paused' : 'failed',
        attemptCount: Math.max(session.activeTaskRun?.attemptCount || 0, failure.attempt),
        failureHistory,
        currentAction: this.store.failureText(failure, true),
      }, {
        phase: paused ? 'paused' : 'failed',
        attemptCount: Math.max(session.activeTaskRun?.attemptCount || 0, failure.attempt),
        nextAction: paused ? 'Resume the current task' : undefined,
      });
      this.events.emitAssistantMessage(session, {
        id: `task-run-error-${Date.now()}`,
        role: 'assistant',
        content: this.store.failureText(failure, true),
        timestamp: now(),
        isError: true,
      });
      return true;
    } finally {
      session.resumeRequested = false;
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
          : /(429|ServerOverloaded|TooManyRequests|temporarily overloaded)/i.test(error?.message || '');
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
      session.consecutiveFailures = 0;
      session.lastToolFailure = undefined;
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
      session.planState.scratchpad = appendScratchpad(session.planState.scratchpad, `Failure: ${description} -> ${errorMessage}`);
      this.store.historyPush(session, {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ ok: false, error: errorMessage }),
      });
      this.events.emitToolResultMessage(session, toolCall.function.name, description, errorMessage, false);

      if (session.consecutiveFailures >= 4) {
        const content = `Too many consecutive failures. Autonomous execution has stopped. Last error: ${errorMessage}`;
        this.store.historyPush(session, { role: 'assistant', content });
        this.events.emitAssistantMessage(session, {
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

    this.events.emitPlanUpdate(session, 'executing');
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
