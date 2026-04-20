import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { app } from 'electron';
import type { LLMMessage } from '../../llm.js';
import type { ChildTaskSummary, TaskRunSummary } from '../../../src/shared/types.js';

interface TranscriptEntry {
  kind: 'message' | 'task' | 'progress' | 'subagent';
  timestamp: number;
  role?: 'user' | 'assistant' | 'tool' | 'system';
  content?: string;
  task?: {
    id: string;
    goal: string;
    phase: string;
    status: string;
    route?: string;
    currentAction?: string;
    finalUrl?: string;
    attemptCount?: number;
    blockingReason?: string;
    autoRetryCount?: number;
    nextAutoRetryAt?: number;
    lastProgressAt?: number;
    checkpointReplayCount?: number;
    watchdogState?: string;
    watchdogAlerts?: number;
    selfCheckCount?: number;
    lastSelfCheckAt?: number;
    longRangePlan?: string[];
    strategyHistory?: Array<{
      action: string;
      summary: string;
      reason: string;
      routeId?: string;
      targetRouteId?: string;
      timestamp: number;
    }>;
    checkpoint?: {
      nextAction?: string;
      knownFacts?: string[];
      completedActions?: string[];
      attemptCount?: number;
      lastProgressAt?: number;
      lastProgressNote?: string;
      progressSignature?: string;
      lastToolName?: string;
      lastToolStatus?: 'success' | 'failure';
      lastToolAt?: number;
      stagnationCount?: number;
      replayCount?: number;
      lastReplayAt?: number;
      lastReplayReason?: string;
    };
  };
  progress?: {
    runId?: string;
    content: string;
  };
  subagent?: {
    id: string;
    parentRunId?: string;
    lineageKey?: string;
    title: string;
    status: string;
    summary?: string;
    error?: string;
  };
}

function clip(text: string, maxChars = 4000) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function getBaseDir() {
  try {
    return app.getPath('userData');
  } catch {
    return path.join(os.homedir(), '.reflex');
  }
}

export class AgentTranscriptStore {
  private writeQueues = new Map<string, Promise<void>>();

  private transcriptPath(sessionId: string) {
    return path.join(getBaseDir(), 'agent-transcripts', `${sessionId}.jsonl`);
  }

  private enqueue(sessionId: string, task: () => Promise<void>) {
    const previous = this.writeQueues.get(sessionId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task);
    this.writeQueues.set(sessionId, next);
    return next;
  }

  async appendMessage(sessionId: string, message: LLMMessage) {
    const entry: TranscriptEntry = {
      kind: 'message',
      timestamp: Date.now(),
      role: message.role as TranscriptEntry['role'],
      content: clip(typeof message.content === 'string' ? message.content : JSON.stringify(message.content)),
    };
    return this.appendEntry(sessionId, entry);
  }

  async appendTaskSnapshot(sessionId: string, taskRun: TaskRunSummary) {
    const route = taskRun.activeHypothesisId
      ? taskRun.hypotheses.find((item) => item.id === taskRun.activeHypothesisId)?.kind || taskRun.activeHypothesisId
      : undefined;
    const entry: TranscriptEntry = {
      kind: 'task',
      timestamp: Date.now(),
      task: {
        id: taskRun.id,
        goal: clip(taskRun.goal, 500),
        phase: taskRun.phase,
        status: taskRun.status,
        route,
        currentAction: taskRun.currentAction ? clip(taskRun.currentAction, 800) : undefined,
        finalUrl: taskRun.finalUrl,
        attemptCount: taskRun.attemptCount,
        blockingReason: taskRun.blockingReason ? clip(taskRun.blockingReason, 500) : undefined,
        autoRetryCount: taskRun.autoRetryCount,
        nextAutoRetryAt: taskRun.nextAutoRetryAt,
        lastProgressAt: taskRun.lastProgressAt,
        checkpointReplayCount: taskRun.checkpointReplayCount,
        watchdogState: taskRun.watchdogState,
        watchdogAlerts: taskRun.watchdogAlerts,
        selfCheckCount: taskRun.selfCheckCount,
        lastSelfCheckAt: taskRun.lastSelfCheckAt,
        longRangePlan: taskRun.longRangePlan.slice(0, 6).map((item) => clip(item, 220)),
        strategyHistory: taskRun.strategyHistory.slice(-6).map((item) => ({
          action: item.action,
          summary: clip(item.summary, 220),
          reason: clip(item.reason, 320),
          routeId: item.routeId,
          targetRouteId: item.targetRouteId,
          timestamp: item.timestamp,
        })),
        checkpoint: {
          nextAction: taskRun.checkpoint.nextAction ? clip(taskRun.checkpoint.nextAction, 800) : undefined,
          knownFacts: taskRun.checkpoint.knownFacts.slice(-12).map((item) => clip(item, 240)),
          completedActions: taskRun.checkpoint.completedActions.slice(-20),
          attemptCount: taskRun.checkpoint.attemptCount,
          lastProgressAt: taskRun.checkpoint.lastProgressAt,
          lastProgressNote: taskRun.checkpoint.lastProgressNote ? clip(taskRun.checkpoint.lastProgressNote, 800) : undefined,
          progressSignature: taskRun.checkpoint.progressSignature ? clip(taskRun.checkpoint.progressSignature, 400) : undefined,
          lastToolName: taskRun.checkpoint.lastToolName,
          lastToolStatus: taskRun.checkpoint.lastToolStatus,
          lastToolAt: taskRun.checkpoint.lastToolAt,
          stagnationCount: taskRun.checkpoint.stagnationCount,
          replayCount: taskRun.checkpoint.replayCount,
          lastReplayAt: taskRun.checkpoint.lastReplayAt,
          lastReplayReason: taskRun.checkpoint.lastReplayReason ? clip(taskRun.checkpoint.lastReplayReason, 400) : undefined,
        },
      },
    };
    return this.appendEntry(sessionId, entry);
  }

  async appendProgress(sessionId: string, runId: string | undefined, content: string) {
    return this.appendEntry(sessionId, {
      kind: 'progress',
      timestamp: Date.now(),
      progress: {
        runId,
        content: clip(content, 1200),
      },
    });
  }

  async appendSubagentSnapshot(sessionId: string, childRun: ChildTaskSummary) {
    return this.appendEntry(sessionId, {
      kind: 'subagent',
      timestamp: Date.now(),
      subagent: {
        id: childRun.id,
        parentRunId: childRun.parentRunId,
        lineageKey: childRun.lineageKey,
        title: clip(childRun.title, 200),
        status: childRun.status,
        summary: childRun.summary ? clip(childRun.summary, 1200) : undefined,
        error: childRun.error ? clip(childRun.error, 800) : undefined,
      },
    });
  }

  async loadRecentMessages(sessionId: string, limit = 12): Promise<LLMMessage[]> {
    const targetPath = this.transcriptPath(sessionId);
    try {
      const content = await fs.readFile(targetPath, 'utf8');
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-200);
      const parsed = lines
        .map((line) => {
          try {
            return JSON.parse(line) as TranscriptEntry;
          } catch {
            return null;
          }
        })
        .filter((item): item is TranscriptEntry => Boolean(item));
      return parsed
        .filter((entry) => entry.kind === 'message' && entry.role && entry.content?.trim())
        .slice(-limit)
        .map((entry) => ({
          role: (entry.role === 'tool' ? 'assistant' : entry.role) || 'assistant',
          content: entry.content || '',
        }));
    } catch {
      return [];
    }
  }

  async loadRecentProgress(sessionId: string, limit = 24): Promise<string[]> {
    const targetPath = this.transcriptPath(sessionId);
    try {
      const content = await fs.readFile(targetPath, 'utf8');
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-400);
      const parsed = lines
        .map((line) => {
          try {
            return JSON.parse(line) as TranscriptEntry;
          } catch {
            return null;
          }
        })
        .filter((item): item is TranscriptEntry => Boolean(item));
      return parsed
        .filter((entry) => entry.kind === 'progress' && entry.progress?.content?.trim())
        .slice(-limit)
        .map((entry) => entry.progress?.content || '');
    } catch {
      return [];
    }
  }

  async loadLatestTaskSnapshot(sessionId: string): Promise<Partial<TaskRunSummary> | null> {
    const targetPath = this.transcriptPath(sessionId);
    try {
      const content = await fs.readFile(targetPath, 'utf8');
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-600);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const entry = JSON.parse(lines[index] || '') as TranscriptEntry;
          if (entry.kind !== 'task' || !entry.task?.id || !entry.task.goal) continue;
          const checkpoint = entry.task.checkpoint || {};
          return {
            id: entry.task.id,
            goal: entry.task.goal,
            mode: 'generic',
            status: entry.task.status as TaskRunSummary['status'],
            phase: entry.task.phase as TaskRunSummary['phase'],
            hypotheses: [],
            attemptCount: entry.task.attemptCount || checkpoint.attemptCount || 0,
            failureHistory: [],
            activeHypothesisId: entry.task.route,
            finalUrl: entry.task.finalUrl,
            currentAction: entry.task.currentAction,
            blockingReason: entry.task.blockingReason,
            autoRetryCount: entry.task.autoRetryCount,
            nextAutoRetryAt: entry.task.nextAutoRetryAt,
            lastProgressAt: entry.task.lastProgressAt || checkpoint.lastProgressAt,
            checkpointReplayCount: entry.task.checkpointReplayCount,
            watchdogState: entry.task.watchdogState as TaskRunSummary['watchdogState'],
            watchdogAlerts: entry.task.watchdogAlerts,
            selfCheckCount: entry.task.selfCheckCount,
            lastSelfCheckAt: entry.task.lastSelfCheckAt,
            longRangePlan: entry.task.longRangePlan || [],
            strategyHistory: (entry.task.strategyHistory || []).map((item) => ({
              id: `transcript-strategy-${item.timestamp}-${item.action}`,
              action: item.action as TaskRunSummary['strategyHistory'][number]['action'],
              summary: item.summary,
              reason: item.reason,
              routeId: item.routeId,
              targetRouteId: item.targetRouteId,
              timestamp: item.timestamp,
            })),
            taskTodos: [],
            childRuns: [],
            checkpoint: {
              phase: entry.task.phase as TaskRunSummary['phase'],
              activeHypothesisId: entry.task.route,
              completedActions: checkpoint.completedActions || [],
              knownFacts: checkpoint.knownFacts || [],
              attemptCount: checkpoint.attemptCount || entry.task.attemptCount || 0,
              nextAction: checkpoint.nextAction,
              lastProgressAt: checkpoint.lastProgressAt || entry.task.lastProgressAt || entry.timestamp,
              lastProgressNote: checkpoint.lastProgressNote,
              progressSignature: checkpoint.progressSignature,
              lastToolName: checkpoint.lastToolName,
              lastToolStatus: checkpoint.lastToolStatus,
              lastToolAt: checkpoint.lastToolAt,
              stagnationCount: checkpoint.stagnationCount || 0,
              replayCount: checkpoint.replayCount || 0,
              lastReplayAt: checkpoint.lastReplayAt,
              lastReplayReason: checkpoint.lastReplayReason,
            },
            createdAt: entry.timestamp,
            updatedAt: entry.timestamp,
          };
        } catch {
          // Ignore malformed lines and continue scanning backwards.
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private appendEntry(sessionId: string, entry: TranscriptEntry) {
    const targetPath = this.transcriptPath(sessionId);
    return this.enqueue(sessionId, async () => {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.appendFile(targetPath, `${JSON.stringify(entry)}\n`, 'utf8');
    });
  }
}
