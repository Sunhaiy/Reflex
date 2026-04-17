import type { PlanState } from './aiTypes';

export interface SSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  // Jump host / bastion proxy
  jumpHost?: string;
  jumpPort?: number;
  jumpUsername?: string;
  jumpPassword?: string;
  jumpPrivateKeyPath?: string;
  // Card metadata
  tags?: string[];    // e.g. ['Prod', 'CN-Hangzhou']
  os?: string;        // cached OS distro name (e.g. 'Ubuntu', 'CentOS')
}

// Agent session persistence
export interface AgentSessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCall?: {
    name: string;
    command: string;
    status: 'pending' | 'executed';
    stdout?: string;
    stderr?: string;
  };
}

export type AgentPlanPhase =
  | 'idle'
  | 'generating'
  | 'executing'
  | 'done'
  | 'stopped'
  | 'paused'
  | 'blocked'
  | 'waiting_approval';

export interface AgentSessionContextWindow {
  promptTokens: number;
  limitTokens: number;
  percentUsed: number;
  compressionCount: number;
  autoCompressed: boolean;
  summaryChars: number;
}

export type TaskTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TaskTodoItem {
  id: string;
  content: string;
  status: TaskTodoStatus;
}

export type ChildTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ChildTaskSummary {
  id: string;
  title: string;
  goal: string;
  mode: 'task' | 'fork';
  parentRunId?: string;
  parentChildRunId?: string;
  lineageKey?: string;
  parentRoute?: string;
  inheritedMemoryChars?: number;
  status: ChildTaskStatus;
  summary?: string;
  error?: string;
  lastAction?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentMemoryFileSummary {
  scope: 'user' | 'workspace' | 'project';
  path: string;
  title: string;
}

export type TaskSourceType = 'local' | 'github';

export type RouteHypothesisKind =
  | 'compose-native'
  | 'dockerfile-native'
  | 'java-runtime'
  | 'python-runtime'
  | 'node-runtime'
  | 'static-nginx';

export type TaskRunStatus =
  | 'idle'
  | 'running'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'blocked'
  | 'retryable_paused';

export type TaskRunPhase =
  | 'understand'
  | 'inspect'
  | 'hypothesize'
  | 'act'
  | 'verify'
  | 'repair'
  | 'complete'
  | 'failed'
  | 'blocked'
  | 'paused';

export type TaskRunMode = 'project' | 'generic' | 'site-followup';

export type TaskWatchdogState = 'healthy' | 'stalled' | 'recovering';

export interface RouteHypothesis {
  id: string;
  kind: RouteHypothesisKind;
  score: number;
  evidence: string[];
  requiredCapabilities: string[];
  disproofSignals: string[];
  summary: string;
  strategyId?: string;
}

export interface RepoAnalysisSummary {
  sourceType: TaskSourceType;
  sourceLabel: string;
  repoName: string;
  framework: string;
  language: string;
  packaging: string;
  outputDir?: string;
  runtimeRequirements: Array<{ name: string; version?: string }>;
  serviceDependencies: string[];
  buildCommands: string[];
  startCommands: string[];
  healthCheckCandidates: string[];
  deploymentHints: string[];
  readmeSummary?: string;
  confidence: number;
}

export interface TaskRunFailure {
  attempt: number;
  routeId?: string;
  failureClass: string;
  message: string;
  timestamp: number;
}

export interface RunCheckpoint {
  phase: TaskRunPhase;
  activeHypothesisId?: string;
  completedActions: string[];
  knownFacts: string[];
  attemptCount: number;
  nextAction?: string;
  lastProgressAt: number;
  lastProgressNote?: string;
  progressSignature?: string;
  lastToolName?: string;
  lastToolStatus?: 'success' | 'failure';
  lastToolAt?: number;
  stagnationCount: number;
  replayCount: number;
  lastReplayAt?: number;
  lastReplayReason?: string;
}

export type StrategyDecisionAction =
  | 'decompose'
  | 'self_check'
  | 'switch_route'
  | 'retry_route'
  | 'reinspect_source'
  | 'replan';

export interface StrategyDecision {
  id: string;
  action: StrategyDecisionAction;
  summary: string;
  reason: string;
  routeId?: string;
  targetRouteId?: string;
  timestamp: number;
}

export interface TaskRunSummary {
  id: string;
  goal: string;
  mode: TaskRunMode;
  status: TaskRunStatus;
  phase: TaskRunPhase;
  source?: {
    type: TaskSourceType;
    label: string;
  };
  repoAnalysis?: RepoAnalysisSummary;
  hypotheses: RouteHypothesis[];
  activeHypothesisId?: string;
  attemptCount: number;
  failureHistory: TaskRunFailure[];
  checkpoint: RunCheckpoint;
  finalUrl?: string;
  currentAction?: string;
  blockingReason?: string;
  autoRetryCount?: number;
  nextAutoRetryAt?: number;
  lastProgressAt?: number;
  checkpointReplayCount?: number;
  watchdogState?: TaskWatchdogState;
  watchdogAlerts?: number;
  selfCheckCount?: number;
  lastSelfCheckAt?: number;
  strategyHistory: StrategyDecision[];
  longRangePlan: string[];
  taskTodos: TaskTodoItem[];
  childRuns: ChildTaskSummary[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentCompactState {
  lastCompactedAt?: number;
  lastBoundaryMessageCount: number;
  consecutiveFailures: number;
  paused: boolean;
}

export interface AgentSessionRuntime {
  planState: PlanState | null;
  planStatus: AgentPlanPhase;
  contextWindow: AgentSessionContextWindow | null;
  compressedMemory?: string;
  compressedRunMemory?: string;
  knownProjectPaths?: string[];
  taskTodos?: TaskTodoItem[];
  memoryFiles?: AgentMemoryFileSummary[];
  compactState?: AgentCompactState | null;
  agentModel?: string;
  agentProfileId?: string;
  activeRunId?: string;
  activeTaskRun?: TaskRunSummary | null;
}

export interface AgentSession {
  id: string;
  title: string;         // auto-generated from first user message
  profileId: string;     // SSHConnection.id — binds session to a server
  host: string;          // for display (doesn't change if server renamed)
  messages: AgentSessionMessage[];
  runtime?: AgentSessionRuntime;
  createdAt: number;
  updatedAt: number;
}


export interface FileEntry {
  name: string;
  type: 'd' | '-';
  size: number;
  date: string;
}

export interface CpuCore {
  id: number;
  usage: number;
}



export interface SystemStats {
  os: {
    distro: string;
    kernel: string;
    uptime: string;
    hostname: string;
  };
  cpu: {
    totalUsage: number;
    cores: CpuCore[];
    model: string;
    speed: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    cached: number;
    buffers: number;
  };
  network: {
    upSpeed: number; // bytes/sec
    downSpeed: number; // bytes/sec
    totalTx: number;
    totalRx: number;
  };
  disks: {
    filesystem: string;
    size: number;
    used: number;
    available: number;
    usePercent: number;
    mount: string;
  }[];
}
