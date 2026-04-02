import { SSHManager } from '../../ssh/sshManager.js';
import { HypothesisPlanner } from '../hypothesisPlanner.js';
import { AgentRepoInspector } from '../repoInspector.js';
import { createAgentToolRegistry } from '../toolRegistry.js';
import type { AgentRuntimeMessage, AgentThreadSession } from '../types.js';
import { AgentEventBus } from './eventBus.js';
import { phaseToPlanStatus } from './helpers.js';
import { AgentQueryEngine } from '../query/queryEngine.js';
import { AgentSessionStore } from '../state/sessionStore.js';
import { AgentAutoCompactService } from '../services/compact/autoCompact.js';
import { AgentForkedAgentService } from './forkedAgent.js';

interface RuntimeStartOptions {
  goal: string;
  threadMessages?: AgentRuntimeMessage[];
  resetPlan: boolean;
}

export class AgentQueryRuntime {
  private hypothesisPlanner = new HypothesisPlanner();
  private repoInspector: AgentRepoInspector;
  private compactService: AgentAutoCompactService;
  private forkedAgentService: AgentForkedAgentService;
  private toolRegistry;
  private queryEngine: AgentQueryEngine;

  constructor(
    _sessionId: string,
    _sshMgr: SSHManager,
    private store: AgentSessionStore,
    private events: AgentEventBus,
  ) {
    this.repoInspector = new AgentRepoInspector(_sshMgr);
    this.compactService = new AgentAutoCompactService();
    this.toolRegistry = createAgentToolRegistry(_sshMgr, {
      createTask: async (session, input) => this.store.createChildRun(session, { ...input, mode: 'task' }),
      runForkedAgent: async (session, input) => this.forkedAgentService.run(session, input),
    });
    this.queryEngine = new AgentQueryEngine(this.toolRegistry, this.store, this.events, this.compactService);
    this.forkedAgentService = new AgentForkedAgentService(this.toolRegistry, this.store);
  }

  async run(session: AgentThreadSession, options: RuntimeStartOptions) {
    if (session.running) {
      throw new Error('Agent is already running in this conversation');
    }

    session.aborted = false;
    session.running = true;
    session.abortController = new AbortController();
    session.turnCounter = 0;
    session.consecutiveFailures = 0;

    const { effectiveGoal, resumeRequested } = await this.store.beginRun(session, {
      goal: options.goal,
      resetPlan: options.resetPlan,
      threadMessages: options.threadMessages,
    });

    const handled = await this.runTaskLoop(session, effectiveGoal, resumeRequested);
    session.running = false;
    const phase = handled && session.activeTaskRun
      ? phaseToPlanStatus(session.activeTaskRun)
      : handled
        ? 'done'
        : 'stopped';
    this.events.emitPlanUpdate(session, session.aborted ? 'stopped' : phase);
  }

  async runTaskLoop(session: AgentThreadSession, goal: string, resumeRequested: boolean): Promise<boolean> {
    session.resumeRequested = resumeRequested;
    return this.queryEngine.runTask(session, goal, {
      resumeRequested,
      repoInspector: this.repoInspector,
      hypothesisPlanner: this.hypothesisPlanner,
    });
  }
}
