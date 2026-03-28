import { WebContents } from 'electron';
import { LLMMessage, LLMProfile, LLMToolDefinition } from '../llm.js';
import { PlanState } from '../../src/shared/aiTypes.js';

export interface AgentToolCallArgs {
  [key: string]: unknown;
}

export interface AgentToolExecutionResult {
  ok: boolean;
  displayCommand: string;
  content: string;
  structured: Record<string, unknown>;
  scratchpadNote?: string;
}

export interface AgentToolDefinition {
  definitions: LLMToolDefinition[];
  execute: (
    name: string,
    args: AgentToolCallArgs,
    session: AgentThreadSession,
  ) => Promise<AgentToolExecutionResult>;
}

export interface AgentRuntimeMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCall?: {
    name: string;
    command: string;
    status: 'pending' | 'executed';
  };
  reasoning?: string;
  isError?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  modelUsed?: string;
}

export interface AgentArtifact {
  id: string;
  title: string;
  preview: string;
  content: string;
  createdAt: number;
}

export interface AgentContextWindow {
  promptTokens: number;
  limitTokens: number;
  percentUsed: number;
  compressionCount: number;
  autoCompressed: boolean;
  summaryChars: number;
}

export interface AgentThreadSession {
  id: string;
  connectionId: string;
  sshHost: string;
  webContents: WebContents;
  profile: LLMProfile;
  aborted: boolean;
  running: boolean;
  turnCounter: number;
  consecutiveFailures: number;
  abortController: AbortController | null;
  history: LLMMessage[];
  compressedMemory: string;
  artifacts: Map<string, AgentArtifact>;
  contextWindow: AgentContextWindow;
  planState: PlanState;
  localContext: {
    cwd: string;
    homeDir: string;
    desktopDir: string;
    platform: string;
  };
  remoteContext?: {
    host: string;
    user: string;
    pwd: string;
    os: string;
    node: string;
    docker: string;
  };
  knownProjectPaths: string[];
}
